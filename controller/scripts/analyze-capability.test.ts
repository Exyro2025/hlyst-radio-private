// Tests for music/analyze-capability.ts — whether an analysis pass widens its
// scope to backfill an optional dimension, and what it says when it doesn't.
//
// This is the decision behind the loudest half of #1300 bug 3. The reported
// symptom was "audio backfill: +90 already-analysed tracks missing an audio
// vector", the same 90 tracks every run forever, on a heavy analyzer whose CLAP
// weights could not be downloaded. Two separate defects met there:
//
//   1. The backend reported `capable: true` no matter what, because the probe
//      behind it is find_spec — "is torch installed" — evaluated at ready,
//      before any model has been asked to load. Fixed at the source (the worker
//      reports the loss, the sidecar remembers it across the idle respawn that
//      was resetting it), and what arrives here is the corrected answer.
//   2. When the answer IS false, the message assumed exactly one cause and told
//      the operator to switch to the heavy image — advice to do the thing they
//      had already done. That is what this module fixes, and why the messages
//      are asserted rather than just the booleans: the string is the entire
//      user-facing product of a broken analyzer.
// Run: `tsx scripts/analyze-capability.test.ts` (folded into `npm run test`).

import assert from 'node:assert/strict';
import { backfillDecision } from '../src/music/analyze-capability.js';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failures++;
    console.error(`  ✗ ${name}\n      ${err?.message || err}`);
  }
}

console.log('analyze capability decision:');

test('a dimension the operator has not enabled says nothing at all', () => {
  const d = backfillDecision({ dimension: 'audio', wanted: false, capable: true, error: null });
  assert.equal(d.widen, false);
  assert.equal(d.notice, null);
  // Even when the backend is broken — an operator who hasn't asked for
  // sounds-like doesn't need a warning about it in their tagging log.
  const off = backfillDecision({
    dimension: 'audio', wanted: false, capable: false, error: 'no weights',
  });
  assert.equal(off.notice, null);
});

test('a capable backend widens silently', () => {
  const d = backfillDecision({ dimension: 'audio', wanted: true, capable: true, error: null });
  assert.equal(d.widen, true);
  assert.equal(d.notice, null);
});

test('an UNKNOWN capability still widens — null is not a no', () => {
  // A local venv that hasn't been probed, or a sidecar too old to advertise.
  // Treating null as "can't" would silently stop backfilling on every older
  // deployment; the pass simply produces no vector and the track stays in scope.
  const d = backfillDecision({ dimension: 'vocal', wanted: true, capable: null, error: null });
  assert.equal(d.widen, true);
  assert.equal(d.notice, null);
});

test('a lean image is told to get the heavy one', () => {
  const d = backfillDecision({ dimension: 'audio', wanted: true, capable: false, error: null });
  assert.equal(d.widen, false);
  assert.match(d.notice!, /built without CLAP/);
  assert.match(d.notice!, /ANALYZER_HEAVY=1/);
});

test('a FAILED LOAD is told the truth instead, and never told to switch image', () => {
  const d = backfillDecision({
    dimension: 'audio',
    wanted: true,
    capable: false,
    error: 'model weights could not be downloaded: [Errno 111] Connection refused',
  });
  assert.equal(d.widen, false, 'a broken model must not widen — that is the churn');
  // The reason reaches the operator verbatim. Without it the two false cases
  // are indistinguishable from outside the container.
  assert.match(d.notice!, /Connection refused/);
  assert.match(d.notice!, /failed to load/);
  // The load-failure branch must NOT carry the lean-image advice: everyone
  // hitting it is already on the heavy image, and sending them to switch is
  // what turned a diagnosable fault into an unexplained loop.
  assert.ok(!/ANALYZER_HEAVY/.test(d.notice!), 'load failure repeats the lean-image advice');
  assert.ok(!/built without/.test(d.notice!));
  // And it says how to retry, because the latch is deliberately sticky.
  assert.match(d.notice!, /restart the analyzer/);
});

test('the vocal dimension names Demucs, not CLAP', () => {
  const lean = backfillDecision({ dimension: 'vocal', wanted: true, capable: false, error: null });
  assert.match(lean.notice!, /built without Demucs/);
  const broken = backfillDecision({
    dimension: 'vocal', wanted: true, capable: false, error: 'checkpoint is corrupt',
  });
  assert.match(broken.notice!, /Demucs is installed but failed to load/);
  assert.match(broken.notice!, /checkpoint is corrupt/);
});

if (failures > 0) {
  console.error(`✗ analyze-capability.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ analyze-capability.test.ts passed');
