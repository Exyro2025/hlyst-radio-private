// The public request boxes moved onto a shared zod schema (controller/src/
// schemas/request.ts), mirrored into web/lib/schemas.generated.ts and run on
// both sides: validateBody on POST /request, and a pre-flight in PlayerCore's
// submitRequest action that every skin's box submits through. These tests pin
// the schema's contract — including the two deliberate tightenings over the
// old hand-rolled readers — and the guard's name cap staying an alias of the
// schema's, so the refusal boundary and the repair belt can't drift apart.
//
// Run: npx tsx scripts/request-schema.test.ts (auto-discovered by npm test).
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateBody } from '../src/middleware/validate.js';
import {
  listenerRequestSchema,
  REQUEST_NAME_MAX,
  REQUEST_TEXT_MAX,
} from '../src/schemas/request.js';
import { cleanRequesterName } from '../src/util/request-guard.js';
import { firstMessage } from '../src/util/zod-error.js';

// --- the happy path ---------------------------------------------------------

test('accepts a bare text and defaults name to empty', () => {
  const r = listenerRequestSchema.parse({ text: 'play something for late-night driving' });
  assert.equal(r.text, 'play something for late-night driving');
  assert.equal(r.name, '');
});

test('trims both fields', () => {
  const r = listenerRequestSchema.parse({ text: '  rainy day vibes  ', name: '  Par  ' });
  assert.equal(r.text, 'rainy day vibes');
  assert.equal(r.name, 'Par');
});

test('explicit null name reads as absent, as the old typeof reader did', () => {
  assert.equal(listenerRequestSchema.parse({ text: 'surprise me', name: null }).name, '');
});

test('caps apply to the trimmed value, not the raw one', () => {
  const padded = `   ${'x'.repeat(REQUEST_TEXT_MAX)}   `;
  assert.equal(listenerRequestSchema.safeParse({ text: padded }).success, true);
});

// --- refusals ---------------------------------------------------------------

test('refuses a missing, empty, whitespace-only or non-string text', () => {
  for (const body of [{}, { text: '' }, { text: '   ' }, { text: 42 }, { text: null }]) {
    const r = listenerRequestSchema.safeParse(body);
    assert.equal(r.success, false, JSON.stringify(body));
    // 'Empty request' is the historical wire message API callers already
    // handle; the custom `error` keeps it for the missing/non-string cases
    // zod would otherwise describe as a type mismatch.
    assert.match(firstMessage(r.error!), /Empty request/);
  }
});

test('refuses over-cap text (the old path silently sliced to 280)', () => {
  // Deliberate tightening: truncation could cut a request mid-thought and
  // have the DJ answer half of it. The box now says so before submitting.
  assert.equal(
    listenerRequestSchema.safeParse({ text: 'x'.repeat(REQUEST_TEXT_MAX) }).success,
    true,
  );
  const r = listenerRequestSchema.safeParse({ text: 'x'.repeat(REQUEST_TEXT_MAX + 1) });
  assert.equal(r.success, false);
  assert.match(r.error!.issues[0].message, /280/);
});

test('refuses an over-cap or non-string name (the old path sliced / coerced)', () => {
  assert.equal(
    listenerRequestSchema.safeParse({ text: 'ok text', name: 'x'.repeat(REQUEST_NAME_MAX) })
      .success,
    true,
  );
  assert.equal(
    listenerRequestSchema.safeParse({ text: 'ok text', name: 'x'.repeat(REQUEST_NAME_MAX + 1) })
      .success,
    false,
  );
  assert.equal(listenerRequestSchema.safeParse({ text: 'ok text', name: 7 }).success, false);
});

// --- messages are listener-facing -------------------------------------------

test('every refusal message stands alone without a field prefix', () => {
  // The player surfaces issues[0].message verbatim in the box, so a message
  // like zod's default "Too big: expected string to have <=280 characters"
  // must never ship. Each custom message reads as a sentence.
  const cases = [
    { text: 'x'.repeat(REQUEST_TEXT_MAX + 1) },
    { text: 'ok text', name: 'x'.repeat(REQUEST_NAME_MAX + 1) },
    { text: 'ok text', name: 7 },
  ];
  for (const body of cases) {
    const r = listenerRequestSchema.safeParse(body);
    assert.equal(r.success, false);
    assert.doesNotMatch(r.error!.issues[0].message, /expected|invalid_/i, JSON.stringify(body));
  }
});

// --- the route boundary ------------------------------------------------------
// Drive the real middleware, not just the schema (the shows-conversion
// lesson): confirm the 400 payload carries the flat `error` string existing
// clients read AND fieldErrors keyed by the field, and that a passing body
// reaches the handler as the PARSED value.

interface FakeRes {
  code: number;
  body: { error?: string; fieldErrors?: Record<string, string> };
}

function runValidate(body: unknown) {
  const res: FakeRes = { code: 0, body: {} };
  const req = { body } as { body: unknown };
  let nexted = false;
  validateBody(listenerRequestSchema)(
    req as never,
    {
      status(c: number) {
        res.code = c;
        return this;
      },
      json(b: FakeRes['body']) {
        res.body = b;
        return this;
      },
    } as never,
    () => {
      nexted = true;
    },
  );
  return { res, nexted, req };
}

test('route: over-cap text 400s with fieldErrors keyed "text"', () => {
  const { res, nexted } = runValidate({ text: 'x'.repeat(REQUEST_TEXT_MAX + 1) });
  assert.equal(nexted, false);
  assert.equal(res.code, 400);
  assert.deepEqual(Object.keys(res.body.fieldErrors ?? {}), ['text']);
  assert.match(String(res.body.error), /^text: /);
});

test('route: a valid body calls next() with the PARSED value on req.body', () => {
  const { nexted, req } = runValidate({ text: '  rainy day vibes  ' });
  assert.equal(nexted, true);
  // Trimmed and name-defaulted — the handler's guard pipeline must see the
  // schema's output, not the raw body.
  assert.deepEqual(req.body, { text: 'rainy day vibes', name: '' });
});

// --- the guard belt stays aligned -------------------------------------------

test('cleanRequesterName still bounds at the schema cap (alias, not a copy)', () => {
  // The guard repairs rather than refuses ('anon', not a 400) for callers
  // that never crossed the route boundary — but its bound must be the same
  // figure the schema refuses over, or the two drift like SKILL_SLUG_RE did.
  const cleaned = cleanRequesterName('x'.repeat(REQUEST_NAME_MAX + 25));
  assert.equal(cleaned.length, REQUEST_NAME_MAX);
});
