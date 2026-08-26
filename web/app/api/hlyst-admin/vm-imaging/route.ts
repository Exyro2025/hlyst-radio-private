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
    SELECT id, imaging_type, text, audio_url, audio_status, status, times_used, last_used_at, created_at
    FROM vm_imaging
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return Response.json({ items: rows });
}
