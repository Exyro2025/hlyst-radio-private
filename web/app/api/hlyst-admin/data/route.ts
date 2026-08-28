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

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const messages = await sql`SELECT * FROM messages ORDER BY created_at DESC LIMIT 100`;
  const voiceNotes = await sql`SELECT * FROM voice_notes ORDER BY created_at DESC LIMIT 100`;

  return Response.json({ messages, voiceNotes });
}
