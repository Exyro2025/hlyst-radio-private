// Pins the banter WINDOW (broadcast/banter-policy.ts + dj-gate's 'banter' rung).
//
// The bug this replaces (#1419): the gap was evaluated at exactly two instants
// an hour, so a station ident scheduled at :15 but boundary-deferred to :19:35
// left 25s of quiet at the :20 tick, the tick stood down, and the next chance
// was 30 minutes away — on `moderate`, which owns only the :20 slot, the whole
// hour was gone. Hours of eligible guest shows aired no banter at all, silently.
//
// Five properties are load-bearing, and each is a real way this regresses:
//
//  - The window has a TAIL. If a minute inside :20–:29 stops reading as the :20
//    slot, the retry is gone and we are back to a single instant.
//  - The retry minute keeps its slot's IDENTITY. dj-gate's rungs are keyed on
//    the slot, so if :24 resolved to anything but 20 a `moderate` station would
//    either lose its retry or gain a second exchange it never had.
//  - The gap itself is UNCHANGED at 5 minutes, and idents still count toward it.
//    "Classify short idents as not-real-talk" is the tempting fix and the wrong
//    one: it lets banter stack right behind an ident, which is what the gap is for.
//  - One fire per slot. A per-minute tick with no slot key is a stream of
//    exchanges, not a window — so the key must be stable across the window and
//    distinct across hours.
//  - The cron expression is DERIVED. A hand-written '20-29,50-59' drifts the
//    moment BANTER_WINDOW_MINUTES changes, and the drift is silent.
//
// STATE_DIR is redirected at a throwaway dir BEFORE the first import so
// settings.load()/update() touch nothing real — hence the dynamic imports. Same
// shape as scripts/clock-policy.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'subwave-banter-'));
process.env.STATE_DIR = root;

const settings = await import('../src/settings.js');
const {
  BANTER_SLOTS, BANTER_WINDOW_MINUTES, BANTER_MIN_GAP_MS,
  banterSlot, banterSlotKey, banterWindowEnd, banterGap, banterCronExpression,
  banterStandDownLine, banterMissedLine,
} = await import('../src/broadcast/banter-policy.js');
const { shouldFire } = await import('../src/broadcast/dj-gate.js');

// The default roster's first persona, re-fadered to the frequency under test —
// the only settings the 'banter' rung reads. Patching the seeded persona (rather
// than writing one from scratch) keeps the strict TTS/soul validators happy;
// same trick as scripts/clock-policy.test.ts.
async function station(frequency: string) {
  await settings.update({
    tts: { enabled: true },
    personas: settings.get().personas.map((p: any, i: number) =>
      (i === 0 ? { ...p, frequency, djMode: false } : p)),
  } as any);
}

const at = (minute: number) => new Date(2026, 7, 19, 9, minute, 0);

test('every minute of a window resolves to the slot that opened it', () => {
  for (const slot of BANTER_SLOTS) {
    for (let i = 0; i < BANTER_WINDOW_MINUTES; i++) {
      assert.equal(banterSlot(slot + i), slot, `:${slot + i} should belong to slot :${slot}`);
    }
    assert.equal(banterWindowEnd(slot), slot + BANTER_WINDOW_MINUTES - 1);
  }
  // The reporter's own case: an ident deferred to :19:35 pushes the exchange to
  // :24:35, which has to still be the :20 slot or there is no retry at all.
  assert.equal(banterSlot(24), 20);
});

test('minutes outside both windows are not a slot', () => {
  for (const m of [0, 15, 19, 30, 45, 49]) {
    assert.equal(banterSlot(m), null, `:${m} must not open a banter window`);
  }
  // The ident slots specifically — a window must never REACH one, or the
  // exchange and the ident are scheduled against each other (issue #310).
  assert.ok(banterSlot(30) === null && banterSlot(45) === null);
  assert.ok(banterWindowEnd(20) < 30);
});

test('the quiet gap is 5 minutes and is measured, not rounded', () => {
  assert.equal(BANTER_MIN_GAP_MS, 5 * 60_000);
  const now = 1_000_000_000_000;
  // The failure from the issue: an ident that aired 25s ago.
  const blocked = banterGap({ nowMs: now, lastTalkBreakAt: now - 25_000 });
  assert.equal(blocked.clear, false);
  assert.equal(blocked.sinceMs, 25_000);
  // Same ident, five minutes later inside the same window — the whole point.
  assert.equal(banterGap({ nowMs: now + 300_000, lastTalkBreakAt: now - 25_000 }).clear, true);
  // Exactly on the boundary counts as clear.
  assert.equal(banterGap({ nowMs: now, lastTalkBreakAt: now - BANTER_MIN_GAP_MS }).clear, true);
  // Nothing has aired yet (fresh boot) reads as an infinite gap, not a zero one.
  const fresh = banterGap({ nowMs: now, lastTalkBreakAt: 0 });
  assert.equal(fresh.clear, true);
  assert.equal(fresh.sinceMs, Infinity);
});

test('a slot key is stable across its window and distinct across hours/slots', () => {
  const opening = banterSlotKey(at(20));
  assert.ok(opening);
  // Stable: every retry minute claims the same slot, so one exchange airs.
  for (let i = 0; i < BANTER_WINDOW_MINUTES; i++) {
    assert.equal(banterSlotKey(at(20 + i)), opening);
  }
  // Distinct: the :50 window and the next hour's :20 are their own chances.
  assert.notEqual(banterSlotKey(at(50)), opening);
  assert.notEqual(banterSlotKey(new Date(2026, 7, 19, 10, 20, 0)), opening);
  assert.notEqual(banterSlotKey(new Date(2026, 7, 20, 9, 20, 0)), opening);
  assert.equal(banterSlotKey(at(15)), null);
});

test('the cron expression is derived from the window constants', () => {
  const expected = BANTER_SLOTS
    .map(s => `${s}-${s + BANTER_WINDOW_MINUTES - 1}`)
    .join(',') + ' * * * *';
  assert.equal(banterCronExpression(), expected);
  // It must cover every minute banterSlot() accepts, and nothing else — the two
  // are read by different callers (node-cron vs the tick) and cannot disagree.
  const covered = new Set<number>();
  for (const range of banterCronExpression().split(' ')[0].split(',')) {
    const [lo, hi] = range.split('-').map(Number);
    for (let m = lo; m <= hi; m++) covered.add(m);
  }
  for (let m = 0; m < 60; m++) {
    assert.equal(covered.has(m), banterSlot(m) !== null, `minute ${m} coverage mismatch`);
  }
});

test('the frequency ladder is unchanged, and reads the slot rather than the minute', async () => {
  await station('quiet');
  // Quiet never auto-banters — anywhere in either window.
  for (const m of [20, 24, 29, 50, 59]) assert.equal(shouldFire('banter', at(m)), false);

  await station('moderate');
  // One an hour: the :20 slot only — but now with its full retry tail.
  for (let i = 0; i < BANTER_WINDOW_MINUTES; i++) {
    assert.equal(shouldFire('banter', at(20 + i)), true, `moderate should retry at :${20 + i}`);
  }
  for (const m of [50, 55, 59]) assert.equal(shouldFire('banter', at(m)), false);

  for (const f of ['chatty', 'aggressive']) {
    await station(f);
    for (const m of [20, 25, 29, 50, 55, 59]) {
      assert.equal(shouldFire('banter', at(m)), true, `${f} should fire at :${m}`);
    }
    // Outside the windows nothing fires, whatever the rung — the ident and
    // hourly minutes stay theirs.
    for (const m of [0, 15, 19, 30, 45, 49]) {
      assert.equal(shouldFire('banter', at(m)), false, `${f} must not fire at :${m}`);
    }
  }
});

test('the station voice switch still sits above the whole window', async () => {
  await station('aggressive');
  await settings.update({ tts: { enabled: false } } as any);
  for (const m of [20, 25, 50, 59]) assert.equal(shouldFire('banter', at(m)), false);
  await settings.update({ tts: { enabled: true } } as any);
  assert.equal(shouldFire('banter', at(25)), true);
});

test('the stand-down lines carry the reason and the numbers', () => {
  const now = 1_000_000_000_000;
  const gap = banterGap({ nowMs: now, lastTalkBreakAt: now - 25_000 });
  const line = banterStandDownLine(20, gap);
  // The issue asked for exactly this: which gap, how long ago, how long is left.
  assert.match(line, /25s ago/);
  assert.match(line, /300s/);
  assert.match(line, /:29/);
  const missed = banterMissedLine(20, gap);
  assert.match(missed, /slot :20 missed/);
  // The last minute of a window is the one case where this is the ONLY line the
  // operator gets, so it carries the numbers too.
  assert.match(missed, /25s ago/);
  assert.match(missed, /300s/);
  // A fresh boot has no last break — the line must not print "Infinitys".
  assert.match(banterStandDownLine(20, banterGap({ nowMs: now, lastTalkBreakAt: 0 })), /never ago/);
});

test.after(() => rmSync(root, { recursive: true, force: true }));
