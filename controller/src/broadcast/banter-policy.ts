// Banter scheduling policy — WHEN a guest-show exchange may air (#1419).
//
// Banter is the only spoken segment gated on a minimum QUIET GAP: it is the
// longest break we air, so it must not pile onto a talk break the listener
// just heard. That rule is right. What was wrong is that the gap was only ever
// evaluated at two instants an hour (a `20,50 * * * *` cron), and the things
// that set the gap don't land on the clock:
//
//   - a station ident is scheduled at :15/:45 but boundary-DEFERRED
//     (announceAtNextTrack), so it airs at the next track transition — :19:35
//     for a :15 ident is ordinary, not an edge case;
//   - the segment director ticks every 5 minutes, including :15 and :20, and
//     its own floor is ZERO on an aggressive station (skills/_agent.ts).
//
// Either one lands inside the 5-minute shadow of the fixed tick, the tick
// stands down, and the next chance is 30 minutes away — on `moderate`, which
// only has the :20 slot, the whole hour is gone. Observed as hours of eligible
// guest shows producing no banter at all.
//
// The fix is a WINDOW rather than an instant: the slot still opens at :20/:50,
// but the tick runs every minute for ten minutes and fires the first minute the
// gap is genuinely clear — so a :19:35 ident postpones the exchange to :24:35
// instead of cancelling it. One fire per slot, so a window can't turn into a
// stream of exchanges. The gap itself is untouched: classifying idents as "not
// real talk" would let banter stack right behind one, which is the thing the
// gap exists to prevent.
//
// Pure and I/O-free (a `Date` in, numbers out) so scripts/banter-policy.test.ts
// can pin the window arithmetic without a scheduler or a clock. The FREQUENCY
// ladder is deliberately NOT here — it stays in dj-gate.ts with the other
// rungs, and asks this module only which slot a minute belongs to.

// Minute each banter window OPENS. Chosen because no other wall-clock talker
// owns them — the ident cron is :15/:30/:45 and the hourly check is :00 (issue
// #310) — so an exchange can't be SCHEDULED against another segment. What it
// can still collide with is a segment that AIRED off-clock, which is what the
// window below absorbs.
export const BANTER_SLOTS = [20, 50] as const;

// How long a slot stays open for. Twice the quiet gap: a talk break that landed
// anywhere inside the 5 minutes before the slot opened clears by the halfway
// point, leaving room for the exchange to render (several TTS calls) and still
// finish well clear of the next ident slot at :30/:00.
export const BANTER_WINDOW_MINUTES = 10;

// Minimum quiet gap before an exchange — every STANDALONE talk break counts
// (idents, hourly, handoff, banter and the segment director's spots), which is
// what queue.getLastTalkBreakAt() reports. Track-tied links are excluded there,
// or a chatty DJ-mode station would never banter.
export const BANTER_MIN_GAP_MS = 5 * 60_000;

// The window a minute falls in, identified by its opening minute, or null
// outside both. Windows never cross an hour boundary by construction (the last
// slot opens at :50 and runs to :59), which is what lets a slot be keyed by
// wall-clock hour below.
export function banterSlot(minute: number): number | null {
  for (const slot of BANTER_SLOTS) {
    if (minute >= slot && minute < slot + BANTER_WINDOW_MINUTES) return slot;
  }
  return null;
}

// Last minute of a slot's window — the tick's final chance, and what the
// stand-down log line quotes so an operator can see how long is left.
export function banterWindowEnd(slot: number): number {
  return slot + BANTER_WINDOW_MINUTES - 1;
}

// Stable identity for "this hour's :20 window", so one exchange per slot
// survives a per-minute tick without a timer or a countdown. Process-local
// time, like every other minute-slot decision in the scheduler: the cron fires
// on process minutes, so the key must agree with it. A DST fall-back repeats an
// hour and re-opens the slot once — harmless, and strictly better than a
// forward jump silently consuming one.
export function banterSlotKey(now: Date): string | null {
  const slot = banterSlot(now.getMinutes());
  if (slot == null) return null;
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  return `${day}-${now.getHours()}-${slot}`;
}

// The cron expression the window implies, derived rather than written out, so
// the schedule and BANTER_SLOTS/BANTER_WINDOW_MINUTES cannot drift apart.
export function banterCronExpression(): string {
  const minutes = BANTER_SLOTS.map(s => `${s}-${banterWindowEnd(s)}`).join(',');
  return `${minutes} * * * *`;
}

export type BanterGap = { clear: boolean; sinceMs: number; needMs: number };

// Whether the quiet gap has elapsed. `lastTalkBreakAt` is 0 when nothing has
// aired yet (a fresh boot), which reads as an infinite gap — correct: there is
// no break to stack onto.
export function banterGap(p: { nowMs: number; lastTalkBreakAt: number }): BanterGap {
  const sinceMs = p.lastTalkBreakAt > 0 ? p.nowMs - p.lastTalkBreakAt : Infinity;
  return { clear: sinceMs >= BANTER_MIN_GAP_MS, sinceMs, needMs: BANTER_MIN_GAP_MS };
}

// The stand-down line the issue asked for: the reason AND the numbers behind
// it, so this class of scheduling collision is visible in the booth log instead
// of being inferred from an absence. Logged once per slot by the caller (a
// per-minute tick would otherwise repeat it ten times).
export function banterStandDownLine(slot: number, gap: BanterGap): string {
  const since = Number.isFinite(gap.sinceMs) ? `${Math.round(gap.sinceMs / 1000)}s` : 'never';
  return `[banter] stood down at :${slot} — last standalone talk ${since} ago, `
    + `minimum gap ${Math.round(gap.needMs / 1000)}s (retrying until :${banterWindowEnd(slot)})`;
}

// The window closed unfired. Carries the gap numbers too, because this is the
// only line an operator gets when the very last minute of a window is the first
// one to be blocked.
export function banterMissedLine(slot: number, gap: BanterGap): string {
  const since = Number.isFinite(gap.sinceMs) ? `${Math.round(gap.sinceMs / 1000)}s` : 'never';
  return `[banter] slot :${slot} missed — last standalone talk ${since} ago, `
    + `minimum gap ${Math.round(gap.needMs / 1000)}s never cleared before :${banterWindowEnd(slot)}`;
}
