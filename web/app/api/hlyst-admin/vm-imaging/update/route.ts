import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

async function isAuthed() {
  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

const VALID_STATUSES = ['draft', 'approved', 'archived'];

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, status, text } = await req.json();
  if (!id || typeof id !== 'number') {
    return Response.json({ error: 'id (number) is required.' }, { status: 400 });
  }

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return Response.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }
    await sql`UPDATE vm_imaging SET status = ${status} WHERE id = ${id}`;
  }

  if (text !== undefined) {
    await sql`UPDATE vm_imaging SET text = ${text} WHERE id = ${id}`;
  }

  return Response.json({ ok: true });
}
