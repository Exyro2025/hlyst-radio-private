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
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../config.js';

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
  style_examples: string[] | null;
  genres: string[] | null;
}

interface HlystScheduleRow {
  day_of_week: string;
  start_time: string;
  persona_id: string;
}

interface HlystArtistMusicRow {
  id: number;
  title: string;
  artist: string;
  composer: string | null;
  genre: string | null;
  duration_seconds: number | null;
  audio_url: string;
  release_status: string;
}

export async function syncFromHlyst(): Promise<void> {
  const url = process.env.HLYST_SYNC_URL;
  const token = process.env.SUBWAVE_SYNC_TOKEN;
  if (!url || !token) return; // not an HLYST-connected deployment

  let personaRows: HlystPersonaRow[];
  let scheduleRows: HlystScheduleRow[];
  let artistMusicRows: HlystArtistMusicRow[];
  try {
    const res = await fetch(url, { headers: { 'x-sync-token': token } });
    if (!res.ok) throw new Error(`HLYST sync fetch failed (${res.status})`);
        const body = await res.json() as {
      personas: HlystPersonaRow[];
      schedule: HlystScheduleRow[];
      artistMusic?: HlystArtistMusicRow[];
    };
    personaRows = body.personas;
    scheduleRows = body.schedule;
    artistMusicRows = body.artistMusic || [];
  } catch (err) {
    settings.get(); // no-op — keeps the queue's error path recognizable in logs
    console.error(`[hlyst-sync] fetch failed: ${(err as Error).message}`);
    return;
  }

  await syncArtistMusicToLibrary(artistMusicRows);

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
    styleExamples: Array.isArray(p.style_examples) ? p.style_examples : [],
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
  // no HLYST-specific schedule shape beyond genre preference.
  //
  // genres wires into SUB/WAVE's existing show-filter feature (schemas/
  // show.ts, music/picker.ts, music/show-filter.ts) — a real, already-built
  // mechanism that was simply never fed any data until now. filtersStrict is
  // deliberately false for every HLYST show: genre here is a soft preference
  // (picker.ts's dominant-but-not-exclusive source), never a hard exclusion —
  // a DJ favors their territory but a crossover track can still be picked.
  // Personas with no genres set (weekend/Sunday specialty shows not covered
  // by an approved profile yet) get an empty list, same as before this
  // change — never invented.
  const shows = personaRows.map(p => ({
    id: `hlyst_${p.id}`,
    name: `HLYST — ${p.name}`,
    personaId: p.id,
    genres: Array.isArray(p.genres) ? p.genres : [],
    filtersStrict: false,
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

// Where Navidrome should be pointed to pick these up — a plain watched
// folder, the standard ingestion path every Subsonic-compatible server
// supports, so nothing here depends on a specific Navidrome admin API. Once
// a Navidrome instance exists, its Music Folder setting (or a mounted volume
// pointing at the same path) is the only wiring left — no further code.
const HLYST_MUSIC_DIR = process.env.HLYST_MUSIC_DIR || `${STATE_DIR}/hlyst-music`;

// Downloads each eligible track ONCE — keyed by HLYST's own id, never
// re-fetched or overwritten once present, so an unchanged master is never
// re-downloaded and Navidrome never sees a file it already scanned change
// out from under it. A track pulled off the eligible list (status changed,
// row deleted) simply stops syncing forward; it isn't retroactively removed
// here, since deciding whether to pull already-aired music off SUB/WAVE's
// catalog is an operator/SUB/WAVE-side call, not this sync's to make.
async function syncArtistMusicToLibrary(rows: HlystArtistMusicRow[]): Promise<void> {
  try {
    await mkdir(HLYST_MUSIC_DIR, { recursive: true });
  } catch (err) {
    console.error(`[hlyst-sync] could not create ${HLYST_MUSIC_DIR}: ${(err as Error).message}`);
    return;
  }

  for (const row of rows) {
    const ext = (row.audio_url.split('.').pop() || 'mp3').split('?')[0];
    const safeArtist = row.artist.replace(/[^\w\- ]/g, '').trim() || 'Unknown Artist';
    const safeTitle = row.title.replace(/[^\w\- ]/g, '').trim() || 'Untitled';
    const filePath = path.join(HLYST_MUSIC_DIR, `hlyst-${row.id}-${safeArtist}-${safeTitle}.${ext}`);

    if (existsSync(filePath)) continue; // already synced — never re-fetch

    try {
      const res = await fetch(row.audio_url);
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(filePath, buf);
      console.log(`[hlyst-sync] added to library: ${row.artist} — ${row.title}`);
    } catch (err) {
      console.error(`[hlyst-sync] failed to sync "${row.title}": ${(err as Error).message}`);
    }
  }
}

export function startHlystSync(): void {
  if (!process.env.HLYST_SYNC_URL) return;
  void syncFromHlyst();
  setInterval(() => void syncFromHlyst(), SYNC_INTERVAL_MS);
}
