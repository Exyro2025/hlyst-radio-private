// Webhook validation moved onto a shared zod schema (controller/src/schemas/).
// These tests pin the PUBLIC contract — validateWebhooksStrict's accept/reject
// decisions and returned shape — not the schema in isolation, because
// settings.update() is the caller that must not change behaviour.
//
// Thrown MESSAGE TEXT is deliberately not asserted: zod's wording differs from
// the old hand-rolled strings. Only accept-vs-reject and the returned object
// are contractual.
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
