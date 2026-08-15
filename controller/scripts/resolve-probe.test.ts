// Pins the push-resolution probe policy (broadcast/resolve-probe.ts) — the
// pure decisions behind "the pick we just handed Liquidsoap never became a
// playable request" (#1405). A push that Liquidsoap accepts but cannot RESOLVE
// (the origin answered with a Subsonic error body, the file is missing) drops
// the request silently; before this probe the controller only noticed via
// reconcileWithDjQueue, three untracked track starts later.
// node:test style, matching the newer scripts/*.test.ts files.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  probeVerdict,
  repickAfterFailure,
  PUSH_PROBE_ABSENT_READS,
  PUSH_PROBE_INTERVAL_MS,
  PUSH_PROBE_MAX_READS,
  MAX_CONSECUTIVE_RESOLVE_FAILURES,
} from '../src/broadcast/resolve-probe.js';

// A push that is live in dj_queue, seen on the first read.
const PRESENT = { probeOk: true, inQueue: true, stillQueuedLocally: true, absentReads: 0 };
// The same push, absent from dj_queue.
const ABSENT = { probeOk: true, inQueue: false, stillQueuedLocally: true, absentReads: 1 };

test('a request listed in dj_queue is resolved, whatever came before it', () => {
  assert.equal(probeVerdict(PRESENT), 'resolved');
  // Presence after an absent read still ends the check — the absence was the
  // 1s poll not having landed yet, which is the whole reason absence needs two
  // reads to count.
  assert.equal(probeVerdict({ ...PRESENT, absentReads: 0, inQueue: true }), 'resolved');
});

test('one absent read is not enough — that is the air-seam race', () => {
  assert.equal(probeVerdict(ABSENT), 'pending');
});

test('absent across the confirm window, still ours and unaired → failed', () => {
  assert.equal(probeVerdict({ ...ABSENT, absentReads: PUSH_PROBE_ABSENT_READS }), 'failed');
  assert.equal(probeVerdict({ ...ABSENT, absentReads: PUSH_PROBE_ABSENT_READS + 1 }), 'failed');
});

test('an item that left `upcoming` is abandoned, never called failed', () => {
  // onTrackStarted splices the item when it airs — the single most likely
  // reason an id leaves dj_queue. Calling that a failure would drop a track
  // that is on air RIGHT NOW and re-pick over it.
  assert.equal(
    probeVerdict({ ...ABSENT, absentReads: PUSH_PROBE_ABSENT_READS, stillQueuedLocally: false }),
    'abandon',
  );
  // Even a present read abandons — there is nothing left to confirm.
  assert.equal(probeVerdict({ ...PRESENT, stillQueuedLocally: false }), 'abandon');
});

test('a failed telnet read fails OPEN — never actionable', () => {
  // Mid-restart / unreachable / garbled. A wrong 'failed' here would drop a
  // perfectly good pick every time the mixer restarts; the pre-#1405
  // reconcile sweep still cleans up genuinely stale items.
  assert.equal(
    probeVerdict({ probeOk: false, inQueue: false, stillQueuedLocally: true, absentReads: 99 }),
    'abandon',
  );
  // The local check is evaluated first, but neither ordering may produce a
  // failure verdict from an unreadable queue.
  assert.equal(
    probeVerdict({ probeOk: false, inQueue: false, stillQueuedLocally: false, absentReads: 99 }),
    'abandon',
  );
});

test('re-picks are budgeted, so a dead origin cannot start a pick storm', () => {
  for (let streak = 1; streak <= MAX_CONSECUTIVE_RESOLVE_FAILURES; streak++) {
    assert.equal(repickAfterFailure(streak), true, `streak ${streak} re-picks`);
  }
  assert.equal(repickAfterFailure(MAX_CONSECUTIVE_RESOLVE_FAILURES + 1), false);
  assert.equal(repickAfterFailure(50), false);
});

test('the read budget can actually reach a verdict', () => {
  // MAX_READS must exceed ABSENT_READS or the loop times out before the
  // failing path can ever conclude — the bug this whole module exists to fix
  // would then simply move.
  assert.ok(PUSH_PROBE_MAX_READS > PUSH_PROBE_ABSENT_READS);
  // And the confirm window must span a watcher tick (1.5s), so an item that
  // just went on air is spliced from `upcoming` before the second read.
  assert.ok(PUSH_PROBE_INTERVAL_MS >= 1_500);
});
