// Read-only sync source for SUB/WAVE. HLYST's Neon schedule/personas are the
// single source of truth (per the architecture decision) — SUB/WAVE polls
// this on an interval and treats the response as authoritative each time, so
// there is never a second copy to keep in sync by hand. Auth is a shared
// secret header, not the admin cookie — this is a server-to-server call from
// the controller, which carries no browser session.

import { neon } from '@neondatabase/serverless';

// Forces dynamic rendering — this route hits the DB at module load
// (const sql = neon(...)) and must never be statically evaluated at
// Docker build time, when TALKWAVE_URL_POSTGRES_URL isn't set.
export const dynamic = 'force-dynamic';


const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

function isAuthed(req: Request) {
  const token = req.headers.get('x-sync-token');
  return !!token && !!process.env.SUBWAVE_SYNC_TOKEN && token === process.env.SUBWAVE_SYNC_TOKEN;
}

export async function GET(req: Request) {
  if (!isAuthed(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personas = await sql`
    SELECT id, name, soul, humour, local_colour, warmth, language,
           frequency, script_length, dj_mode, tts_voice_id, tts_engine
    FROM personas
    WHERE is_imaging = false
  `;

   const schedule = await sql`
    SELECT day_of_week, start_time, persona_id
    FROM schedule
  `;

  // Eligible Artist Music — real songs that should enter SUB/WAVE's actual
  // playable catalog, not just get mentioned in DJ speech. release_status is
  // the existing eligibility control (per the library's own design); nothing
  // new is invented here. SUB/WAVE's own blocklist/picker rules stay the
  // final say on when/whether any given track actually airs — this only
  // makes the master available to that authoritative system.
  const artistMusic = await sql`
    SELECT id, title, artist, composer, genre, duration_seconds, audio_url, release_status
    FROM artist_music
    WHERE release_status IN ('NEW_RELEASE', 'CURRENT', 'CATALOG')
  `;

    return Response.json({ personas, schedule, artistMusic });
}
