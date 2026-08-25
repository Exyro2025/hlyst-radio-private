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

  const messages = await sql`SELECT * FROM messages ORDER BY created_at DESC LIMIT 100`;
  const voiceNotes = await sql`SELECT * FROM voice_notes ORDER BY created_at DESC LIMIT 100`;

  return Response.json({ messages, voiceNotes });
}
