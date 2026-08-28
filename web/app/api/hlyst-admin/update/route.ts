import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';

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

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { table, id, status } = await req.json();

  if (!['messages', 'voice_notes'].includes(table)) {
    return Response.json({ error: 'Invalid table.' }, { status: 400 });
  }
  if (!['new', 'approved', 'rejected', 'archived'].includes(status)) {
    return Response.json({ error: 'Invalid status.' }, { status: 400 });
  }

  if (table === 'messages') {
    await sql`UPDATE messages SET status = ${status} WHERE id = ${id}`;
  } else {
    await sql`UPDATE voice_notes SET status = ${status} WHERE id = ${id}`;
  }

  return Response.json({ ok: true });
}
