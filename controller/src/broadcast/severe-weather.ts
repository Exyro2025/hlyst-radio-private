// Severe/consequential weather alerts — sourced from the National Weather
// Service (api.weather.gov, keyless). Dormant by design (brief §21): NO
// hourly forecast, NO ordinary temperature/condition chatter (that's the
// separate, already-existing ambient weather SKILL — skills/builtins/weather —
// which this module does not touch or replace). This module exists ONLY for
// alerts NWS itself classifies Severe or Extreme: tornado/severe thunderstorm/
// flash flood/winter storm/excessive heat-cold warnings and the like.
//
// Never fabricates: a failed/empty/stale NWS fetch means silence. Each
// DISTINCT alert (by NWS's own alert id) earns exactly one report — updates
// or re-checks of an alert already reported don't repeat it, which is what
// lets a genuinely new severe alert "override ordinary spacing" (brief) without
// a station-wide cooldown gate standing in its way, the way traffic.ts's does.
//
// Suspended during a programme-mode episode (Lystenne) UNLESS Extraordinary
// Event Mode (#22) is active — routine severe weather sits below scheduled
// programming in the airtime hierarchy; only a genuine emergency supersedes
// Lystenne (brief §23).

import * as settings from '../settings.js';
import { djObject } from '../llm/sdk.js';
import { z } from 'zod';
import * as memory from './dj-agent/dj-memory.js';
import * as session from './session.js';
import { djCallsAllowed } from './listeners.js';
import { autoVoiceAllowed } from './voice-policy.js';
import * as budget from './dj-budget.js';
import * as emergencyMode from './emergency-mode.js';

const NWS_BASE = 'https://api.weather.gov/alerts/active';
// NWS requires a descriptive User-Agent, not an API key — no invented
// contact info, just a plain identifier for the station's integration.
const NWS_USER_AGENT = 'HLYST-Radio-Weather-Integration';

// Only these NWS severity classes count as "consequential" per the brief;
// Moderate/Minor/Unknown stay silent — this is the dormancy boundary.
const QUALIFYING_SEVERITIES = new Set(['Severe', 'Extreme']);

export interface NwsAlert {
  id: string;
  event: string;
  headline: string;
  description: string;
  severity: string;
  expires: string | null;
}

async function fetchSevereAlerts(): Promise<NwsAlert[] | null> {
  const w = settings.get()?.weather;
  const lat = w?.lat;
  const lng = w?.lng;
  if (lat == null || lng == null) return null;
  try {
    const url = `${NWS_BASE}?point=${lat},${lng}`;
    const res = await fetch(url, { headers: { 'User-Agent': NWS_USER_AGENT, Accept: 'application/geojson' } });
    if (!res.ok) return null;
    const body: any = await res.json();
    const features = Array.isArray(body?.features) ? body.features : null;
    if (!features) return null;
    return features
      .map((f: any) => {
        const p = f.properties || {};
        return {
          id: String(f.id || p.id || ''),
          event: String(p.event || '').trim(),
          headline: String(p.headline || '').trim(),
          description: String(p.description || '').trim(),
          severity: String(p.severity || 'Unknown'),
          expires: p.expires || null,
        };
      })
      .filter((a: NwsAlert) => a.id && a.event);
  } catch {
    return null;
  }
}

function isQualifying(a: NwsAlert): boolean {
  return QUALIFYING_SEVERITIES.has(a.severity);
}

// See traffic.ts's identical rationale — the `programme` flag on the
// resolved active show is the only "an episode is airing" signal this
// codebase already surfaces. Bypassed entirely once Extraordinary Event Mode
// is active, per brief §23's "only genuine emergency override" rule.
function suspendedByProgramme(): boolean {
  if (emergencyMode.isActive()) return false;
  try {
    return !!settings.resolveActiveShow()?.programme;
  } catch {
    return false;
  }
}

const copySchema = z.object({
  text: z.string().describe('the exact words the DJ says on air, stating only the given alert facts'),
});

async function generateSevereWeatherCopy(alert: NwsAlert): Promise<string | null> {
  const persona = session.onAirPersona();
  const system = `You are ${persona?.name || 'the station DJ'}, delivering a brief on-air severe weather
alert for your listening area. Use ONLY the facts given below — never invent a location,
timing, or condition. This is a genuine public-safety alert: keep it clear, direct, and
brief. No stage directions, no radio-cliché tells, no downplaying it as small talk.`;
  const facts = `Event: ${alert.event}\nHeadline: ${alert.headline}\n${alert.description ? `Details: ${alert.description.slice(0, 500)}` : ''}`;
  try {
    const out = await djObject({
      system,
      prompt: `${facts}\n\nGive the alert now.`,
      schema: copySchema,
      temperature: 0.4,
      kind: 'severeWeatherAlert',
    });
    return out?.text?.trim() || null;
  } catch {
    return null;
  }
}

// Called once per watcher tick from queue.ts, mirroring maybeTraffic.
export interface SevereWeatherTestResult {
  ranAt: string;
  alertUsed: { id: string; event: string; severity: string; headline: string } | null;
  qualifies: boolean;
  activeDj: string | null;
  copy: string | null;
  wouldAir: boolean;
  reason: string;
}

// Called once per watcher tick from queue.ts, mirroring maybeTraffic.
// dryRun mode (options.dryRun) exercises the full real pipeline — qualification filter,
// copy generation via the real LLM call, active-DJ lookup — against either a supplied
// fakeAlert or a real fetch, but returns a result object instead of calling
// queue.announceAtNextTrack, so nothing is scheduled to actually air.
export async function maybeSevereWeather(
  queue: any,
  options?: { dryRun?: boolean; fakeAlert?: NwsAlert }
): Promise<SevereWeatherTestResult | void> {
  const dryRun = options?.dryRun === true;

  if (!dryRun) {
    if (!djCallsAllowed() || !autoVoiceAllowed() || !budget.optionalSegmentsAllowed()) return;
    if (suspendedByProgramme()) return;
  }

  const alerts = dryRun && options?.fakeAlert ? [options.fakeAlert] : await fetchSevereAlerts();
  if (!alerts) {
    if (dryRun) {
      return { ranAt: new Date().toISOString(), alertUsed: null, qualifies: false, activeDj: null, copy: null, wouldAir: false, reason: 'no alerts available (fetch failed or none active)' };
    }
    return;
  }
  const qualifying = alerts.filter(isQualifying);
  if (!qualifying.length) {
    if (dryRun) {
      const a = alerts[0];
      return { ranAt: new Date().toISOString(), alertUsed: { id: a.id, event: a.event, severity: a.severity, headline: a.headline }, qualifies: false, activeDj: null, copy: null, wouldAir: false, reason: 'alert did not qualify under QUALIFYING_SEVERITIES' };
    }
    return;
  }

  for (const alert of qualifying) {
    const claimKey = dryRun ? `test:${alert.id}` : `alert:${alert.id}`;
    if (!dryRun && memory.recentlyDid('SEVERE_WEATHER', 24 * 3_600_000, claimKey)) continue;
    const text = await generateSevereWeatherCopy(alert);
    const activeDj = session.onAirPersona()?.name ?? null;
    if (!text) {
      if (dryRun) {
        return { ranAt: new Date().toISOString(), alertUsed: { id: alert.id, event: alert.event, severity: alert.severity, headline: alert.headline }, qualifies: true, activeDj, copy: null, wouldAir: false, reason: 'copy generation failed' };
      }
      memory.recordEvent('SEVERE_WEATHER', { subject: claimKey });
      queue.log('weather', `Severe alert "${alert.event}" — copy generation failed, skipping`);
      continue;
    }
    if (dryRun) {
      queue.log('weather-test', `DRY RUN: would air severe-weather break for "${alert.event}" via ${activeDj ?? 'no persona currently on air'}: "${text}"`);
      memory.recordEvent('SEVERE_WEATHER_TEST', { subject: claimKey });
      return { ranAt: new Date().toISOString(), alertUsed: { id: alert.id, event: alert.event, severity: alert.severity, headline: alert.headline }, qualifies: true, activeDj, copy: text, wouldAir: true, reason: 'dry run only — real broadcast NOT performed, normal programming unaffected' };
    }
    memory.recordEvent('SEVERE_WEATHER', { subject: claimKey });
    await queue.announceAtNextTrack(text, 'severe-weather', { persona: session.onAirPersona() });
    return;
  }
  if (dryRun) {
    return { ranAt: new Date().toISOString(), alertUsed: null, qualifies: false, activeDj: null, copy: null, wouldAir: false, reason: 'all qualifying alerts already claimed in the last 24h (cooldown)' };
  }
}
