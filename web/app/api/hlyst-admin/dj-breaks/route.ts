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
    SELECT b.id, b.persona_id, p.name AS persona_name, b.break_type, b.reason, b.text,
           b.status, b.error_detail, b.created_at, b.audio_url, b.audio_status
    FROM dj_breaks b
    JOIN personas p ON p.id = b.persona_id
    ORDER BY b.created_at DESC
    LIMIT 50
  `;
  return Response.json({ breaks: rows });
}
