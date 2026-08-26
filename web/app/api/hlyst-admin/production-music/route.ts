// Saves a Production Music row after the audio file is already sitting in
// Blob (uploaded via upload-token/route.ts) and the owner has reviewed the
// client-detected metadata. The HLY-### asset ID is assigned here,
// server-side, from a real Postgres sequence — not computed client-side —
// so two near-simultaneous uploads can't collide on the same number.

import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

async function isAuthed() {
  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rows = await sql`
    SELECT id, hly_id, title, artist, composer, genre, duration_seconds, file_format,
           file_size_bytes, audio_url, artwork_url, classifications, uploaded_at
    FROM production_music
    ORDER BY uploaded_at DESC
    LIMIT 200
  `;
  return Response.json({ items: rows });
}

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const {
    title, artist, composer, genre,
    durationSeconds, fileFormat, fileSizeBytes,
    audioUrl, artworkUrl, classifications,
  } = await req.json();

  if (!title || typeof title !== 'string') {
    return Response.json({ error: 'title is required.' }, { status: 400 });
  }
  if (!audioUrl || typeof audioUrl !== 'string') {
    return Response.json({ error: 'audioUrl is required (upload the file first).' }, { status: 400 });
  }

  const seqRows = await sql`SELECT nextval('production_music_hly_id_seq') AS n`;
  const n = Number((seqRows[0] as any).n);
  const hlyId = `HLY-${String(n).padStart(3, '0')}`;

  const insertRows = await sql`
    INSERT INTO production_music
      (hly_id, title, artist, composer, genre, duration_seconds, file_format, file_size_bytes, audio_url, artwork_url, classifications)
    VALUES (
      ${hlyId}, ${title}, ${artist || 'HLYST'}, ${composer || ''}, ${genre || ''},
      ${durationSeconds ?? null}, ${fileFormat ?? null}, ${fileSizeBytes ?? null},
      ${audioUrl}, ${artworkUrl ?? null}, ${Array.isArray(classifications) ? classifications : []}
    )
    RETURNING id, hly_id
  `;

  return Response.json({ id: (insertRows[0] as any).id, hlyId: (insertRows[0] as any).hly_id });
}
