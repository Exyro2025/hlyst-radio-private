import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';

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
  try {
    const rows = await sql`
      SELECT id, listener_name, message, category, safety_reason, created_at
      FROM messages
      WHERE status = 'quarantined'
      ORDER BY created_at ASC
    `;
    return Response.json({ queue: rows });
  } catch (err) {
    console.error('Talk Wave queue fetch failed:', err);
    return Response.json({ error: 'Could not load the queue.' }, { status: 500 });
  }
}
