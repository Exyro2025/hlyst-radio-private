// Ported from controller/src/broadcast/dj-gate.ts (station-ID/hourly minute
// gating by frequency tier) and banter-policy.ts (the "minimum quiet gap"
// idea, adapted here as the ad-lib/talkwave floor since HLYST personas have
// no guest-show concept to gate banter against). This is a PORT, not a
// rewrite — the frequency ladder and minute-slot logic below match the
// controller's real values exactly (dj-gate.ts, checked against source
// before writing this).
//
// Real, honest limitation: the controller's full picture includes
// track-level signals (current/next track, transition opportunity) that
// HLYST's Postgres architecture has no data source for yet — no queue, no
// persisted now-playing history (broadcastProvider.ts's Live365 metadata is
// still honestly null). This decision function works from what IS available
// — wall-clock time, schedule boundaries, and the DJ Breaks log itself — and
// says so via the `reason` field rather than pretending track awareness it
// doesn't have.

export type Frequency = 'silent' | 'quiet' | 'moderate' | 'chatty' | 'aggressive';
const FREQUENCIES: Frequency[] = ['silent', 'quiet', 'moderate', 'chatty', 'aggressive'];

export type BreakType = 'show_open' | 'show_close' | 'station_id' | 'hourly' | 'talkwave_response' | 'ad_lib';

export interface BreakDecisionInput {
  frequency: Frequency;
  djMode: boolean;
  now: Date; // already resolved to station-local time by the caller
  /** Minutes since the current schedule slot started (0 = just started). */
  minutesIntoShow: number;
  /** Minutes remaining until the current schedule slot ends. */
  minutesUntilShowEnd: number;
  lastBreakAt: Date | null;
  lastBreakType: BreakType | null;
  approvedTalkWaveCount: number;
}

export interface BreakDecision {
  shouldSpeak: boolean;
  breakType?: BreakType;
  reason: string;
}

// Ported exactly from controller/src/settings/persona.ts effectiveFrequency:
// DJ mode bumps one rung up the ladder; 'silent' is an explicit operator
// promise and never gets bumped out of it.
function effectiveFrequency(frequency: Frequency, djMode: boolean): Frequency {
  if (!djMode) return frequency;
  if (frequency === 'silent') return frequency;
  const i = FREQUENCIES.indexOf(frequency);
  return FREQUENCIES[Math.min(i + 1, FREQUENCIES.length - 1)] ?? frequency;
}

// Adapted floor for ad-lib/Talk Wave segments — the controller's real
// version gates these on track count, which HLYST has no data for yet.
// Time-based equivalents, not an exact port: flagged as an adaptation, not
// a faithful translation of the original numbers.
const AD_LIB_MIN_GAP_MINUTES: Record<Frequency, number> = {
  silent: Infinity,
  quiet: 20,
  moderate: 10,
  chatty: 6,
  aggressive: 3,
};

function minutesSince(a: Date | null, now: Date): number {
  if (!a) return Infinity;
  return (now.getTime() - a.getTime()) / 60000;
}

export function decideBreak(input: BreakDecisionInput): BreakDecision {
  const freq = effectiveFrequency(input.frequency, input.djMode);
  const minute = input.now.getMinutes();
  const gapMin = minutesSince(input.lastBreakAt, input.now);

  if (freq === 'silent') {
    return { shouldSpeak: false, reason: 'Persona frequency is silent — never auto-fires.' };
  }

  // Show open: once, within the first 2 minutes of the slot, and not
  // already the last thing said (covers a re-tick landing in the same
  // window).
  if (input.minutesIntoShow <= 2 && input.lastBreakType !== 'show_open') {
    return { shouldSpeak: true, breakType: 'show_open', reason: 'Show just started.' };
  }

  // Show close / handoff: once, within the last 3 minutes of the slot.
  if (input.minutesUntilShowEnd <= 3 && input.lastBreakType !== 'show_close') {
    return { shouldSpeak: true, breakType: 'show_close', reason: 'Show ending soon — handoff.' };
  }

  // Hourly time check: fires every hour, or every other hour on 'quiet' —
  // matches dj-gate.ts's shouldFire('hourly') exactly. Guarded by gapMin so
  // a re-tick in the same minute doesn't double-fire.
  if (minute === 0 && gapMin > 1) {
    const hour = input.now.getHours();
    const allowed = freq === 'quiet' ? hour % 2 === 0 : true;
    if (allowed) {
      return { shouldSpeak: true, breakType: 'hourly', reason: 'Top of the hour, frequency tier allows it.' };
    }
  }

  // Station ID: exact minute slots per tier, ported from dj-gate.ts.
  // Deliberately never at :00 (reserved for the hourly check above).
  if (gapMin > 1) {
    let stationIdMinute = false;
    if (freq === 'quiet') stationIdMinute = minute === 45;
    else if (freq === 'moderate') stationIdMinute = minute === 15 || minute === 45;
    else stationIdMinute = [15, 30, 45].includes(minute); // chatty, aggressive
    if (stationIdMinute) {
      return { shouldSpeak: true, breakType: 'station_id', reason: `Station ID slot for ${freq} tier.` };
    }
  }

  // Talk Wave: only once real approved items exist, and only after the
  // same time floor as an ad-lib would need — a Talk Wave read-out is a
  // real segment, not a free extra, so it still respects "music primary."
  if (input.approvedTalkWaveCount > 0 && gapMin >= AD_LIB_MIN_GAP_MINUTES[freq] && input.lastBreakType !== 'talkwave_response') {
    return { shouldSpeak: true, breakType: 'talkwave_response', reason: `${input.approvedTalkWaveCount} approved Talk Wave item(s) waiting, gap floor met.` };
  }

  // Ad-lib: the time-based floor, adapted from the controller's track-count
  // floor per the header note above.
  if (gapMin >= AD_LIB_MIN_GAP_MINUTES[freq]) {
    return { shouldSpeak: true, breakType: 'ad_lib', reason: `${Math.round(gapMin)} min since last break, meets ${freq} floor of ${AD_LIB_MIN_GAP_MINUTES[freq]} min.` };
  }

  return {
    shouldSpeak: false,
    reason: `Only ${Math.round(gapMin)} min since last break — ${freq} floor is ${AD_LIB_MIN_GAP_MINUTES[freq]} min. Music stays primary.`,
  };
}
