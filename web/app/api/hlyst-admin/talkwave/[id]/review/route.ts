import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

async function isAuthed() {
  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const messageId = Number(id);
  if (!Number.isInteger(messageId)) {
    return Response.json({ error: 'Invalid message id.' }, { status: 400 });
  }
  const { decision } = await req.json();
  if (decision !== 'approve' && decision !== 'reject') {
    return Response.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 });
  }
  const status = decision === 'approve' ? 'approved' : 'rejected';
  try {
    const rows = await sql`
      UPDATE messages
      SET status = ${status}, reviewed_at = now(), reviewed_by = 'owner'
      WHERE id = ${messageId} AND status = 'quarantined'
      RETURNING id
    `;
    if (!rows.length) {
      return Response.json({ error: 'Message not found or already reviewed.' }, { status: 404 });
    }
    return Response.json({ ok: true, id: messageId, status });
  } catch (err) {
    console.error('Talk Wave review failed:', err);
    return Response.json({ error: 'Could not save the review.' }, { status: 500 });
  }
}
