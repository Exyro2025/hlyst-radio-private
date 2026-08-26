// Artist Music library. Deliberately separate from production_music (own
// table, own routes, own admin tab) — the two libraries must never mix
// operationally per spec. No HLY-### asset ID here (that's a
// Production-Music-specific internal ID); real artist releases keep their
// real Title/Artist as detected/entered, and carry a release_status
// instead — the editorial "is this new" signal, not a song title.

import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { del } from '@vercel/blob';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

async function isAuthed() {
  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

const VALID_RELEASE_STATUSES = ['NEW_RELEASE', 'CURRENT', 'CATALOG'];

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rows = await sql`
    SELECT id, title, artist, composer, genre, duration_seconds, file_format,
           file_size_bytes, audio_url, artwork_url, release_status, release_date, uploaded_at
    FROM artist_music
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
    audioUrl, artworkUrl, releaseStatus, releaseDate,
  } = await req.json();

  if (!title || typeof title !== 'string') {
    return Response.json({ error: 'title is required.' }, { status: 400 });
  }
  if (!artist || typeof artist !== 'string') {
    return Response.json({ error: 'artist is required.' }, { status: 400 });
  }
  if (!audioUrl || typeof audioUrl !== 'string') {
    return Response.json({ error: 'audioUrl is required (upload the file first).' }, { status: 400 });
  }
  const status = VALID_RELEASE_STATUSES.includes(releaseStatus) ? releaseStatus : 'CURRENT';

  const insertRows = await sql`
    INSERT INTO artist_music
      (title, artist, composer, genre, duration_seconds, file_format, file_size_bytes, audio_url, artwork_url, release_status, release_date)
    VALUES (
      ${title}, ${artist}, ${composer || ''}, ${genre || ''},
      ${durationSeconds ?? null}, ${fileFormat ?? null}, ${fileSizeBytes ?? null},
      ${audioUrl}, ${artworkUrl ?? null}, ${status}, ${releaseDate || null}
    )
    RETURNING id
  `;

  return Response.json({ id: (insertRows[0] as any).id });
}

export async function DELETE(req: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await req.json();
  if (!id || typeof id !== 'number') {
    return Response.json({ error: 'id (number) is required.' }, { status: 400 });
  }

  const rows = await sql`SELECT audio_url, artwork_url FROM artist_music WHERE id = ${id}`;
  if (!rows.length) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }
  const r = rows[0] as any;

  const urlsToDelete = [r.audio_url, r.artwork_url].filter(Boolean) as string[];
  if (urlsToDelete.length) {
    try {
      await del(urlsToDelete);
    } catch {
      // Same reasoning as production-music's delete: an orphaned Blob file
      // is a smaller problem than a delete button that silently fails.
    }
  }

  await sql`DELETE FROM artist_music WHERE id = ${id}`;
  return Response.json({ ok: true });
}
