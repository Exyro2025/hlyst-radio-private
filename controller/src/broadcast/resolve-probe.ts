// Push-resolution probe policy — the pure decisions behind "the pick we just
// handed Liquidsoap never became a playable request" (#1405).
//
// Background: drainToLiquidsoap writes one annotated URI to next.txt and marks
// the item `sent`. That is the ONLY confirmation the controller had: a push
// that Liquidsoap accepts but cannot RESOLVE (the origin answered with a
// Subsonic error body, the file is missing, the fetch timed out) drops the
// request silently. The station falls through to the unfiltered auto playlist,
// and because `upcoming.length !== 0` gates the auto-DJ, nothing re-picks until
// reconcileWithDjQueue clears the stale item — and that only runs when an
// UNTRACKED track starts, needing EMPTY_DJ_QUEUE_CLEAR_THRESHOLD of them. Three
// auto tracks is 10-25 minutes of unfiltered radio for one bad URL.
//
// So after a push, probe dj_queue for the item's own id. A request stays listed
// while it downloads and while it waits its turn; it leaves the list only when
// it airs or when resolution FAILED. Pure and I/O-free so
// scripts/resolve-probe.test.ts can pin the state machine.

// How long after the push (and between probes) to read dj_queue. Liquidsoap
// polls next.txt every 1.0s and writeHandoff already waited for that poll to
// consume the file, so one second is the floor; two leaves room for a slow tick
// without making the whole check feel like a timeout.
export const PUSH_PROBE_INTERVAL_MS = 2_000;

// Consecutive absent reads before the push is called failed. Absence has one
// benign cause — the request was pulled for air in the moment between reads —
// and `stillQueuedLocally` catches that as soon as onTrackStarted splices the
// item (within one 1.5s watcher tick). Requiring two reads spans that tick, so
// the seam race resolves itself rather than costing a wrongly re-picked track.
export const PUSH_PROBE_ABSENT_READS = 2;

// Hard ceiling on probes for one item. Presence ends the check immediately, so
// this only bounds the failing path: PUSH_PROBE_ABSENT_READS to decide, plus
// slack for a read that comes back present-then-absent.
export const PUSH_PROBE_MAX_READS = 4;

// Consecutive resolution failures that may each trigger an immediate re-pick.
// Past it the station coasts on auto.m3u until the next natural pick: when a
// whole music origin is down, every re-pick fails the same way, and a re-pick
// storm burns LLM budget to queue tracks that cannot air. Music never stops
// either way — that is what the auto playlist is for.
export const MAX_CONSECUTIVE_RESOLVE_FAILURES = 3;

// 'resolved' — the request is live in dj_queue; stop probing, it is real.
// 'pending'  — absent, but not for long enough to be sure; probe again.
// 'failed'   — absent across PUSH_PROBE_ABSENT_READS reads while the item is
//              still ours and unaired: Liquidsoap dropped it.
// 'abandon'  — nothing left to verify, or nothing trustworthy to verify it
//              WITH. Never actionable.
export type ProbeVerdict = 'resolved' | 'pending' | 'failed' | 'abandon';

export function probeVerdict(p: {
  // The telnet read succeeded. A failed read means the controller cannot see
  // dj_queue at all — mid-restart, unreachable, garbled — and this gate fails
  // OPEN like the other Liquidsoap probes: the cost of a wrong 'failed' is a
  // dropped good pick plus a re-pick, the cost of a wrong 'abandon' is the
  // pre-#1405 behaviour, which reconcileWithDjQueue still cleans up.
  probeOk: boolean;
  // The item's subsonic id is pending in dj_queue.
  inQueue: boolean;
  // The item is still in `upcoming` and still flagged sent — i.e. it has not
  // aired (onTrackStarted splices it), was not cancelled, and was not already
  // cleared by a reconcile.
  stillQueuedLocally: boolean;
  // Consecutive absent reads including this one.
  absentReads: number;
}): ProbeVerdict {
  if (!p.stillQueuedLocally) return 'abandon';
  if (!p.probeOk) return 'abandon';
  if (p.inQueue) return 'resolved';
  return p.absentReads >= PUSH_PROBE_ABSENT_READS ? 'failed' : 'pending';
}

// Whether a confirmed resolution failure may trigger an immediate re-pick.
// `streak` counts failures INCLUDING this one.
export function repickAfterFailure(streak: number): boolean {
  return streak <= MAX_CONSECUTIVE_RESOLVE_FAILURES;
}
