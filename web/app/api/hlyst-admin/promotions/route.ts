// Promotions library — same shape as production-music (upload → review →
// save), but with real scheduling controls. No separate playout path: an
// eligible promo enters the exact same SUB/WAVE bridge call every other
// station-production element uses (see engine-tick/route.ts).

import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { storageProvider } from '@/lib/providers/StorageProvider';

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
    SELECT id, title, audio_url, active, start_at, end_at, eligible_persona_ids,
           min_separation_minutes, times_used, last_used_at, created_at
    FROM promotions
    ORDER BY created_at DESC
    LIMIT 200
  `;
  return Response.json({ items: rows });
}

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const {
    title, audioUrl, active, startAt, endAt,
    eligiblePersonaIds, minSeparationMinutes,
  } = await req.json();

  if (!title || typeof title !== 'string') {
    return Response.json({ error: 'title is required.' }, { status: 400 });
  }
  if (!audioUrl || typeof audioUrl !== 'string') {
    return Response.json({ error: 'audioUrl is required (upload the file first).' }, { status: 400 });
  }

  const insertRows = await sql`
    INSERT INTO promotions
      (title, audio_url, active, start_at, end_at, eligible_persona_ids, min_separation_minutes)
    VALUES (
      ${title}, ${audioUrl}, ${active !== false}, ${startAt || null}, ${endAt || null},
      ${Array.isArray(eligiblePersonaIds) ? eligiblePersonaIds : []},
      ${Number.isFinite(minSeparationMinutes) ? minSeparationMinutes : 60}
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

  const rows = await sql`SELECT audio_url FROM promotions WHERE id = ${id}`;
  if (!rows.length) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }
  const r = rows[0] as any;
  try {
    await storageProvider.del([r.audio_url]);
  } catch {
    // Same reasoning as production-music's delete — an orphaned file is a
    // smaller problem than a delete button that silently fails.
  }

  await sql`DELETE FROM promotions WHERE id = ${id}`;
  return Response.json({ ok: true });
}
