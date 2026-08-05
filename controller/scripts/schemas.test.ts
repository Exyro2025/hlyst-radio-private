// Webhook validation moved onto a shared zod schema (controller/src/schemas/).
// These tests pin the PUBLIC contract — validateWebhooksStrict's accept/reject
// decisions and returned shape — not the schema in isolation, because
// settings.update() is the caller that must not change behaviour.
//
// Thrown message WORDING is deliberately not asserted: zod's phrasing differs
// from the old hand-rolled strings. Only accept-vs-reject and the returned
// object are contractual — plus the message SHAPE (one readable line, never a
// ZodError JSON blob), which is pinned at the bottom of this file.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.STATE_DIR = mkdtempSync(path.join(tmpdir(), 'subwave-schemas-'));

const { validateWebhooksStrict } = await import('../src/settings/validate.js');
const { WEBHOOK_EVENTS, WEBHOOKS_LIMIT, webhooksPatchSchema } = await import(
  '../src/schemas/webhook.js'
);

const hook = (over = {}) => ({
  id: 'wh_aaa111',
  url: 'https://example.com/hook',
  events: ['track.play'],
  enabled: true,
  authHeader: '',
  ...over,
});

test('accepts a well-formed hook and returns the normalised shape', () => {
  const [h] = validateWebhooksStrict([hook()]);
  assert.equal(h.id, 'wh_aaa111');
  assert.equal(h.url, 'https://example.com/hook');
  assert.deepEqual(h.events, ['track.play']);
  assert.equal(h.enabled, true);
  assert.equal(h.authHeader, '');
});

test('rejects the inputs the hand-rolled validator rejected', () => {
  assert.throws(() => validateWebhooksStrict('nope' as unknown));
  assert.throws(() => validateWebhooksStrict([hook({ url: 'ftp://x.com' })]));
  assert.throws(() => validateWebhooksStrict([hook({ url: 'https://e.com/' + 'x'.repeat(500) })]));
  assert.throws(() => validateWebhooksStrict([hook({ events: [] })]));
  assert.throws(() => validateWebhooksStrict([hook({ events: ['not.a.real.event'] })]));
  assert.throws(() =>
    validateWebhooksStrict(Array.from({ length: WEBHOOKS_LIMIT + 1 }, () => hook({ id: undefined }))),
  );
});

test('trims the url and defaults enabled to true', () => {
  const [h] = validateWebhooksStrict([{ url: '  https://e.com/h  ', events: ['dj.say'] }]);
  assert.equal(h.url, 'https://e.com/h');
  assert.equal(h.enabled, true);
});

test('authHeader sentinel: "set" keeps the prior value', () => {
  const existing = [hook({ authHeader: 'Bearer real-secret' })];
  const [h] = validateWebhooksStrict([hook({ authHeader: 'set' })], existing);
  assert.equal(h.authHeader, 'Bearer real-secret');
});

test('authHeader sentinel: "set" with no prior value yields empty', () => {
  const [h] = validateWebhooksStrict([hook({ authHeader: 'set' })], []);
  assert.equal(h.authHeader, '');
});

test('authHeader: any other string replaces', () => {
  const existing = [hook({ authHeader: 'Bearer old' })];
  const [h] = validateWebhooksStrict([hook({ authHeader: 'Bearer new' })], existing);
  assert.equal(h.authHeader, 'Bearer new');
});

test('mints an id when absent and re-mints on collision', () => {
  const [a, b] = validateWebhooksStrict([
    hook({ id: undefined }),
    hook({ id: undefined }),
  ]);
  assert.match(a.id, /^wh_[a-z0-9]+$/);
  assert.notEqual(a.id, b.id);

  const [c, d] = validateWebhooksStrict([hook({ id: 'wh_dupe1' }), hook({ id: 'wh_dupe1' })]);
  assert.equal(c.id, 'wh_dupe1');
  assert.notEqual(d.id, 'wh_dupe1');
});

test('de-duplicates events, preserving first-seen order', () => {
  const [h] = validateWebhooksStrict([
    hook({ events: ['dj.link', 'track.play', 'dj.link'] }),
  ]);
  assert.deepEqual(h.events, ['dj.link', 'track.play']);
});

test('WEBHOOK_EVENTS holds exactly the four fan-out events', () => {
  assert.deepEqual([...WEBHOOK_EVENTS], [
    'track.play',
    'dj.say',
    'dj.link',
    'request.received',
  ]);
});

test('patch schema accepts each field independently', () => {
  // The route lets the listener gate save without re-submitting the hook list,
  // and vice versa. Both must stay optional.
  assert.equal(webhooksPatchSchema.safeParse({ webhooks: [hook()] }).success, true);
  assert.equal(webhooksPatchSchema.safeParse({ trackPlayListenerGated: true }).success, true);
  assert.equal(webhooksPatchSchema.safeParse({}).success, true);
});

// Deliberate tightenings over the hand-rolled validator these replaced. Each
// case previously succeeded by silent coercion; the schema now rejects it, so
// a malformed value fails loudly at save time rather than producing a broken
// webhook that only fails later at fire time. Ruled acceptable 2026-08-04:
// settings.json is only ever written by this validator, so stored data is
// always well-formed.
test('rejects a non-boolean enabled (old validator coerced via !== false)', () => {
  assert.throws(() => validateWebhooksStrict([hook({ enabled: 'true' })]));
});

test('rejects an authHeader over 500 chars (old validator silently truncated)', () => {
  assert.throws(() => validateWebhooksStrict([hook({ authHeader: 'x'.repeat(600) })]));
});

test('rejects a non-string authHeader (old validator silently emptied it)', () => {
  assert.throws(() => validateWebhooksStrict([hook({ authHeader: 42 })]));
});

test('rejects a malformed id (old validator silently re-minted a fresh one)', () => {
  assert.throws(() => validateWebhooksStrict([hook({ id: 'BAD-ID!' })]));
});

// --- The thrown MESSAGE, not just the throw. update() is reached by callers
// that never touch POST /webhooks — backup restore (routes/backup.ts) and
// PUT /settings (routes/settings/core.ts) — and both answer with
// res.status(400).json({ error: err.message }). A raw ZodError's .message is a
// pretty-printed JSON array of issue objects, ~15 lines for one bad URL, which
// would land verbatim in the operator's toast. ---

const messageOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail('expected a throw');
};

test('throws a readable single line, not a ZodError JSON blob', () => {
  const msg = messageOf(() => validateWebhooksStrict([hook({ url: 'ftp://x.com' })]));
  assert.ok(!msg.includes('\n'), `expected one line, got:\n${msg}`);
  assert.doesNotThrow(() => {
    // A ZodError message parses as a JSON array of issues. A readable message
    // must not.
    assert.throws(() => JSON.parse(msg), 'message parsed as JSON — it is still a ZodError blob');
  });
  assert.match(msg, /http:\/\/ or https:\/\//);
  // Named down to the ROW, so an operator restoring a backup knows which
  // setting is at fault AND which entry in it — a list of sixteen hooks with
  // one bad url is otherwise unsearchable from the message alone.
  assert.match(msg, /^webhooks\.0\.url: /);
});

test('the thrown message distinguishes one bad row from another', () => {
  const bad = (i: number) =>
    messageOf(() =>
      validateWebhooksStrict(
        Array.from({ length: 3 }, (_, n) => hook({ url: n === i ? 'ftp://x.com' : 'https://ok.com' })),
      ),
    );
  assert.notEqual(bad(0), bad(2));
  assert.match(bad(2), /^webhooks\.2\.url: /);
});

test('a plain Error, not a ZodError instance', () => {
  // Callers do `err.message`; anything relying on `.issues` would be reaching
  // through the persistence chokepoint into zod's shape.
  try {
    validateWebhooksStrict([hook({ url: 'ftp://x.com' })]);
    assert.fail('expected a throw');
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.equal((e as Error & { issues?: unknown }).issues, undefined);
  }
});

test('a top-level type error names the field too', () => {
  const msg = messageOf(() => validateWebhooksStrict('nope' as unknown));
  assert.ok(!msg.includes('\n'), `expected one line, got:\n${msg}`);
  assert.match(msg, /^webhooks: /);
});
