// Pulls HLYST's Neon schedule/personas and mirrors them into SUB/WAVE's own
// settings (personas + shows + the hourly schedule grid) via the existing
// validated settings.update() chokepoint. HLYST owns the real data; this is
// a cache that gets fully overwritten on every sync, never hand-edited — the
// same mechanism that keeps it from drifting IS the fact that update()
// replaces the whole personas/shows array each time, so a manual edit made
// directly in SUB/WAVE's admin is simply gone on the next sync cycle.
//
// Entirely optional: no-ops silently when HLYST_SYNC_URL isn't set, so a
// plain (non-HLYST) SUB/WAVE deployment is unaffected.

import * as settings from '../settings.js';

const SYNC_INTERVAL_MS = 5 * 60_000; // matches HLYST's own engine-tick cadence

const DAY_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

// HLYST's 6 four-hour blocks per day — each start hour owns itself and the
// next 3 hours, matching web/app/api/on-air/route.ts's SLOT_STARTS exactly.
const SLOT_STARTS = [2, 6, 10, 14, 18, 22];
function hoursForSlot(startTime: string): number[] {
  const startHour = Number(startTime.split(':')[0]);
  const idx = SLOT_STARTS.indexOf(startHour);
  const span = idx === -1 ? 4 : (SLOT_STARTS[(idx + 1) % SLOT_STARTS.length] - startHour + 24) % 24 || 4;
  return Array.from({ length: span }, (_, i) => (startHour + i) % 24);
}

interface HlystPersonaRow {
  id: string;
  name: string;
  soul: string;
  humour: number | null;
  local_colour: number | null;
  warmth: number | null;
  language: string | null;
  frequency: string;
  script_length: string;
  dj_mode: boolean;
  tts_voice_id: string | null;
  tts_engine: string | null;
}

interface HlystScheduleRow {
  day_of_week: string;
  start_time: string;
  persona_id: string;
}

export async function syncFromHlyst(): Promise<void> {
  const url = process.env.HLYST_SYNC_URL;
  const token = process.env.SUBWAVE_SYNC_TOKEN;
  if (!url || !token) return; // not an HLYST-connected deployment

  let personaRows: HlystPersonaRow[];
  let scheduleRows: HlystScheduleRow[];
  try {
    const res = await fetch(url, { headers: { 'x-sync-token': token } });
    if (!res.ok) throw new Error(`HLYST sync fetch failed (${res.status})`);
    const body = await res.json();
    personaRows = body.personas;
    scheduleRows = body.schedule;
  } catch (err) {
    settings.get(); // no-op — keeps the queue's error path recognizable in logs
    console.error(`[hlyst-sync] fetch failed: ${(err as Error).message}`);
    return;
  }

  const personas = personaRows.map(p => ({
    id: p.id,
    name: p.name,
    soul: p.soul,
    frequency: p.frequency,
    scriptLength: p.script_length,
    djMode: p.dj_mode,
    humour: p.humour ?? undefined,
    localColour: p.local_colour ?? undefined,
    warmth: p.warmth ?? undefined,
    language: p.language ?? '',
    tts: {
      engine: 'cloud',
      cloudProvider: 'elevenlabs',
      voice: p.tts_voice_id ?? '',
      gainDb: 0,
      speed: 1,
    },
  }));

  // One show per persona — their general on-air identity. The hourly grid
  // below is what actually places them on the clock; the show itself carries
  // no HLYST-specific schedule shape.
  const shows = personas.map(p => ({
    id: `hlyst_${p.id}`,
    name: `HLYST — ${p.name}`,
    personaId: p.id,
  }));

  const grid: (string | null)[][] = Array.from({ length: 7 }, () => Array(24).fill(null));
  for (const row of scheduleRows) {
    const day = DAY_INDEX[row.day_of_week];
    if (day == null) continue;
    const showId = `hlyst_${row.persona_id}`;
    for (const hour of hoursForSlot(row.start_time)) {
      grid[day][hour] = showId;
    }
  }

  try {
    await settings.update({ personas, shows, schedule: grid });
  } catch (err) {
    console.error(`[hlyst-sync] settings.update failed: ${(err as Error).message}`);
  }
}

export function startHlystSync(): void {
  if (!process.env.HLYST_SYNC_URL) return;
  void syncFromHlyst();
  setInterval(() => void syncFromHlyst(), SYNC_INTERVAL_MS);
}
