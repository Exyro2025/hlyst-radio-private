import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { storageProvider } from '@/lib/providers/StorageProvider';

// Forces dynamic rendering — this route hits the DB at module load
// (const sql = neon(...)) and must never be statically evaluated at
// Docker build time, when TALKWAVE_URL_POSTGRES_URL isn't set.
export const dynamic = 'force-dynamic';


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
    SELECT id, imaging_type, text, audio_url, audio_status, status, times_used, last_used_at, created_at
    FROM vm_imaging
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return Response.json({ items: rows });
}

// Mirrors production-music's DELETE: remove the stored audio file first (best
// effort — an already-missing or unreachable file still lets the row delete
// proceed, since a stray orphaned file is a much smaller problem than a
// delete button that silently does nothing), then the database row.
export async function DELETE(req: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await req.json();
  if (!id || typeof id !== 'number') {
    return Response.json({ error: 'id (number) is required.' }, { status: 400 });
  }

  const rows = await sql`SELECT audio_url FROM vm_imaging WHERE id = ${id}`;
  if (!rows.length) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }
  const audioUrl = (rows[0] as any).audio_url as string | null;

  if (audioUrl) {
    try {
      await storageProvider.del([audioUrl]);
    } catch {
      // Already gone or unreachable — proceed to remove the row anyway.
    }
  }

  await sql`DELETE FROM vm_imaging WHERE id = ${id}`;
  return Response.json({ ok: true });
}
