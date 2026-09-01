// Greater Cleveland / Northeast Ohio traffic reports — sourced from ODOT's
// OHGO public API. Two firing paths, both boundary-deferred through the
// existing queue.announceAtNextTrack() (no parallel scheduler, brief §20):
//
//  - SCHEDULED: weekday rush windows (6-9 AM, 3-6 PM), one report per
//    qualifying hour, claimed via dj-memory so a restart or a slow tick can't
//    double-fire the same hour's slot.
//  - EXCEPTIONAL: outside those windows, only a genuinely major incident
//    (closure, multi-vehicle, fatality, hazmat, etc. — judged from OHGO's own
//    description text, never invented) can trigger a report, gated by its own
//    minimum gap so one big incident doesn't spam updates.
//
// Never fabricates: a failed/empty/stale OHGO fetch means silence, not a
// guess. Suspended entirely during a programme-mode episode (Lystenne) and
// behind the same djCallsAllowed/autoVoiceAllowed/budget gates every other
// autonomous segment already respects — traffic sits BELOW scheduled
// programming and emergency override in the airtime hierarchy, never above.
//
// No verified OHGO region-filter param for this deployment — incidents are
// filtered CLIENT-SIDE against NE Ohio interstates/counties rather than
// trusting an unconfirmed server-side filter to actually narrow anything.

import * as settings from '../settings.js';
import { djObject } from '../llm/sdk.js';
import { z } from 'zod';
import * as memory from './dj-agent/dj-memory.js';
import * as session from './session.js';
import { djCallsAllowed } from './listeners.js';
import { autoVoiceAllowed } from './voice-policy.js';
import * as budget from './dj-budget.js';

const OHGO_BASE = 'https://publicapi.ohgo.com/api/v1/incidents';

// Rush windows, station-local time, weekdays only.
const MORNING_SLOTS = [6, 7, 8, 9];
const EVENING_SLOTS = [15, 16, 17, 18];

const NE_OHIO_KEYWORDS = [
  'I-90', 'I-71', 'I-77', 'I-480', 'I-271', 'I-176', 'I-490', 'SR-2', 'SR-8',
  'Cuyahoga', 'Lake County', 'Geauga', 'Lorain', 'Medina', 'Summit County',
  'Portage', 'Cleveland', 'Akron', 'Parma', 'Lakewood', 'Euclid',
];

// Keyword heuristic for "genuinely major" — judged from OHGO's own
// Description/RoadwayName text, never invented. Two-tier: MUST match a real
// severity signal, and MUST NOT be explained solely by a routine minor cause
// (a disabled/stalled vehicle blocking a lane is common and not "major" even
// when OHGO's own text says a lane is "closed" for it — bare 'closed' was
// firing on exactly this the first time this ran live, which is precisely
// what the brief's "genuinely major" bar exists to exclude). Calibrate
// further against real payloads as more incidents are observed.
const MAJOR_KEYWORDS = [
  'all lanes closed', 'road closed', 'highway closed', 'full closure',
  'multi-vehicle', 'multi vehicle', 'fatal', 'fatality', 'injury',
  'hazmat', 'overturned', 'jackknif', 'rollover', 'roll over',
  'major delay', 'major crash', 'serious crash',
];

// Routine causes that, even when OHGO's text says a lane is "closed" for
// them, are NOT what "genuinely major" means — a stalled/disabled vehicle
// blocking one lane is common and clears quickly.
const ROUTINE_CAUSE_KEYWORDS = [
  'disabled vehicle', 'stalled vehicle', 'stalled car', 'debris',
];
interface OhgoIncident {
  description: string;
  roadwayName?: string;
  location?: string;
  direction?: string;
}

// Raw fetch — returns null on ANY failure (network, non-200, malformed body,
// missing key). Never throws into the caller; a null result IS the "stay
// silent" signal per the brief's no-fabrication rule.
async function fetchIncidents(): Promise<OhgoIncident[] | null> {
  const apiKey = process.env.OHGO_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(OHGO_BASE, {
      headers: { Authorization: `APIKEY ${apiKey}` },
    });
    if (!res.ok) return null;
    const body: any = await res.json();
    const results = Array.isArray(body?.results) ? body.results
      : Array.isArray(body?.Results) ? body.Results
      : null;
    if (!results) return null;
    return results.map((r: any) => ({
      description: String(r.description ?? r.Description ?? '').trim(),
      roadwayName: r.roadwayName ?? r.RouteName ?? r.RoadwayName ?? undefined,
      location: r.location ?? r.Location ?? undefined,
      direction: r.direction ?? r.Direction ?? undefined,
    })).filter((i: OhgoIncident) => i.description);
  } catch {
    return null;
  }
}

function inNortheastOhio(i: OhgoIncident): boolean {
  const haystack = `${i.description} ${i.roadwayName ?? ''} ${i.location ?? ''}`.toLowerCase();
  return NE_OHIO_KEYWORDS.some(k => haystack.includes(k.toLowerCase()));
}

function isMajor(i: OhgoIncident): boolean {
  const haystack = i.description.toLowerCase();
  if (!MAJOR_KEYWORDS.some(k => haystack.includes(k))) return false;
  // A severity keyword matched, but if the incident's own text attributes it
  // to a routine cause with no OTHER severity signal (no injury/fatality/
  // hazmat/etc. alongside it), treat it as not major — a partial lane
  // closure for a stalled car is not "genuinely major" even though the word
  // "closed" can appear in its description.
  const routineCauseOnly = ROUTINE_CAUSE_KEYWORDS.some(k => haystack.includes(k))
    && !['fatal', 'fatality', 'injury', 'hazmat', 'multi-vehicle', 'multi vehicle'].some(k => haystack.includes(k));
  return !routineCauseOnly;
}
// Weekday + hour check, station-local. Returns the matching slot hour (for
// the claim key) or null when outside both rush windows.
function scheduledSlot(now: Date): number | null {
  const day = now.getDay(); // 0 Sun .. 6 Sat
  if (day === 0 || day === 6) return null;
  const hour = now.getHours();
  if (MORNING_SLOTS.includes(hour)) return hour;
  if (EVENING_SLOTS.includes(hour)) return hour;
  return null;
}

// Suspended during a programme-mode episode (Lystenne) — resolveActiveShow's
// `programme` flag (settings/persona.ts resolveShowShape) is the only signal
// this codebase already surfaces for "an episode is airing". If Lystenne ends
// up using a different flag, point this at that instead — flagging this as
// the one part of this module built on an inference rather than a confirmed
// field, since I haven't seen programme.ts directly.
function programmeEpisodeActive(): boolean {
  try {
    return !!settings.resolveActiveShow()?.programme;
  } catch {
    return false;
  }
}

const copySchema = z.object({
  text: z.string().describe('the exact words the DJ says on air, stating only the given facts'),
});

// Write the on-air line from the ALREADY-VERIFIED incident list only — the
// model is not asked to decide whether to report, only how to say what it
// was given. Empty `incidents` never reaches this function.
async function generateTrafficCopy(incidents: OhgoIncident[]): Promise<string | null> {
  const persona = session.onAirPersona();
  const facts = incidents.slice(0, 3).map(i => {
    const where = i.roadwayName || i.location || '';
    return `- ${i.description}${where ? ` (${where}${i.direction ? `, ${i.direction}` : ''})` : ''}`;
  }).join('\n');
  const system = `You are ${persona?.name || 'the station DJ'}, giving a brief live traffic report for
Greater Cleveland / Northeast Ohio. Use ONLY the facts listed below — never invent a
location, cause, delay, or condition not given to you. Keep it brief, natural, in your
own on-air voice. No stage directions, no radio-cliché tells.`;
  try {
    const out = await djObject({
      system,
      prompt: `Verified current traffic conditions:\n${facts}\n\nGive the report now.`,
      schema: copySchema,
      temperature: 0.5,
      kind: 'trafficReport',
    });
    return out?.text?.trim() || null;
  } catch {
    return null;
  }
}

// Called once per watcher tick from queue.ts, mirroring maybeAutonomousBreak.
export async function maybeTraffic(queue: any): Promise<void> {
  if (!djCallsAllowed() || !autoVoiceAllowed() || !budget.optionalSegmentsAllowed()) return;
  // Below scheduled programming in the airtime hierarchy — Lystenne (and any
  // other programme-mode episode) is never interrupted for routine traffic.
  if (programmeEpisodeActive()) return;

  const now = new Date();
  const slot = scheduledSlot(now);

  if (slot != null) {
    const claimKey = `sched:${now.toISOString().slice(0, 10)}:${String(slot).padStart(2, '0')}`;
    if (memory.recentlyDid('TRAFFIC_REPORT', 55 * 60_000, claimKey)) return;
    const incidents = await fetchIncidents();
    if (!incidents) {
      queue.log('traffic', `OHGO unavailable — skipping the ${slot}:00 scheduled report`);
      return;
    }
    const local = incidents.filter(inNortheastOhio);
    // Claim the slot regardless of whether there's anything to report — the
    // brief asks for the OPPORTUNITY at top of hour, not a forced report
    // when conditions are genuinely clear.
    memory.recordEvent('TRAFFIC_REPORT', { subject: claimKey });
    if (!local.length) {
      queue.log('traffic', `${slot}:00 scheduled report — no NE Ohio incidents to report`);
      return;
    }
    const text = await generateTrafficCopy(local);
    if (!text) {
      queue.log('traffic', `${slot}:00 scheduled report — copy generation failed, skipping`);
      return;
    }
    await queue.announceAtNextTrack(text, 'traffic', { persona: session.onAirPersona() });
    return;
  }

  // Exceptional path — outside rush windows entirely, only a genuinely major
  // local incident can trigger a report, gapped so one incident doesn't spam.
  if (memory.recentlyDid('TRAFFIC_REPORT', 60 * 60_000, 'exceptional')) return;
  const incidents = await fetchIncidents();
  if (!incidents) return;
  const majorLocal = incidents.filter(i => inNortheastOhio(i) && isMajor(i));
  if (!majorLocal.length) return;
  const text = await generateTrafficCopy(majorLocal);
  if (!text) return;
  memory.recordEvent('TRAFFIC_REPORT', { subject: 'exceptional' });
  await queue.announceAtNextTrack(text, 'traffic', { persona: session.onAirPersona() });
}