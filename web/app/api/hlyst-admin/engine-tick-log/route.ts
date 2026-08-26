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
    SELECT id, ran_at, persona_id, should_speak, break_type, reason, skipped_duplicate, error_detail
    FROM engine_tick_log
    ORDER BY ran_at DESC
    LIMIT 30
  `;
  return Response.json({ ticks: rows });
}
