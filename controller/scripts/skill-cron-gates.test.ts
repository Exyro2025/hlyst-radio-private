// Pins skillCronAllowed() (broadcast/scheduler.ts) — the gate a per-skill cron
// timer checks before calling runCapability() directly.
//
// The bug: a cron-registered skill bypassed every station-wide autonomous-talk
// gate skillsTick applies (voice off, mid-programme, no listeners, over the
// daily token budget) — CLAUDE.md's carve-out for "manual /dj/segment command
// routes" is explicitly for an EXPLICIT OPERATOR ACTION, and a scheduled timer
// firing on its own is not one. Left ungated, a cron skill would still speak
// and spend tokens with `tts.enabled: false` set, past the daily LLM hard cap,
// with zero listeners, and mid-episode.
//
// skillCronAllowed() takes its four inputs as an explicit object rather than
// reading autoVoiceAllowed()/programme.onAir()/djCallsAllowed()/
// optionalSegmentsAllowed() itself, so the rule can be pinned here without
// needing to fake real settings/listener/budget/programme state — the same
// split as budgetMode({used, cap, softPct}) in dj-budget.ts.
//
// Run: `tsx scripts/skill-cron-gates.test.ts`.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// STATE_DIR must be set before config.js resolves it at import time — scheduler.ts
// pulls in modules (settings, queue, …) that derive paths from it at module scope.
process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'skill-cron-gates-'));

const { skillCronAllowed } = await import('../src/broadcast/scheduler.js');

const ALL_OPEN = {
  voiceAllowed: true,
  programmeOnAir: false,
  djCallsAllowed: true,
  optionalSegmentsAllowed: true,
};

assert.equal(skillCronAllowed(ALL_OPEN), true, 'every gate open → cron is allowed to fire');

assert.equal(
  skillCronAllowed({ ...ALL_OPEN, voiceAllowed: false }),
  false,
  'tts.enabled: false ("music only") must stand the cron down',
);
assert.equal(
  skillCronAllowed({ ...ALL_OPEN, programmeOnAir: true }),
  false,
  'a programme episode owns its talk moments — the cron must stand down mid-episode',
);
assert.equal(
  skillCronAllowed({ ...ALL_OPEN, djCallsAllowed: false }),
  false,
  'zero listeners must stand the cron down, same as every other autonomous tick',
);
assert.equal(
  skillCronAllowed({ ...ALL_OPEN, optionalSegmentsAllowed: false }),
  false,
  'over the daily LLM token budget must stand the cron down — no model call past the hard cap',
);

// Any single closed gate is enough — this is a strict AND, not a majority vote.
for (const key of Object.keys(ALL_OPEN) as Array<keyof typeof ALL_OPEN>) {
  const closed = { ...ALL_OPEN, [key]: key === 'programmeOnAir' };
  assert.equal(skillCronAllowed(closed), false, `closing "${key}" alone must block the cron`);
}

console.log('skill-cron-gates.test.ts — all assertions passed');
