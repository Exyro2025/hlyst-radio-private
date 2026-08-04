// The route-boundary body validator. The error payload is deliberately
// ADDITIVE: `error` stays a flat human-readable string (every existing
// client reads exactly that from a 400), and `fieldErrors` is new.
import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

const { firstMessage, flattenIssues } = await import('../src/middleware/validate.js');

const schema = z.object({
  webhooks: z
    .array(z.object({ url: z.string().regex(/^https?:\/\//, 'URL must start with http:// or https://') }))
    .optional(),
});

test('flattenIssues keys errors by dotted field path', () => {
  const r = schema.safeParse({ webhooks: [{ url: 'https://ok.com' }, { url: 'nope' }] });
  assert.equal(r.success, false);
  assert.deepEqual(flattenIssues(r.error), {
    'webhooks.1.url': 'URL must start with http:// or https://',
  });
});

test('firstMessage returns a flat human-readable string', () => {
  const r = schema.safeParse({ webhooks: [{ url: 'nope' }] });
  assert.equal(r.success, false);
  assert.equal(firstMessage(r.error), 'URL must start with http:// or https://');
});

test('firstMessage prefixes the path when the message alone is ambiguous', () => {
  const r = schema.safeParse({ webhooks: 'notanarray' });
  assert.equal(r.success, false);
  // Path-prefixed, because "expected array, received string" alone tells the
  // operator nothing about WHICH field is wrong.
  assert.match(firstMessage(r.error), /^webhooks: /);
});

test('flattenIssues keeps only the first error per field', () => {
  const two = z.object({ url: z.string().min(5, 'too short').regex(/^https/, 'bad scheme') });
  const r = two.safeParse({ url: 'ftp' });
  assert.equal(r.success, false);
  assert.equal(Object.keys(flattenIssues(r.error)).length, 1);
  assert.equal(flattenIssues(r.error)['url'], 'too short');
});
