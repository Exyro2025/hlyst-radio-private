import { neon } from '@neondatabase/serverless';
import { classifySubmission, statusForVerdict } from '@/lib/talkwaveModeration';

export const dynamic = 'force-dynamic';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

export async function POST(req: Request) {
  try {
    const { listenerName, message } = await req.json();
    if (!message || typeof message !== 'string' || !message.trim()) {
      return Response.json({ error: 'Message is required.' }, { status: 400 });
    }
    if (message.length > 1000) {
      return Response.json({ error: 'Message is too long.' }, { status: 400 });
    }

    const trimmed = message.trim();
    const { category, verdict, reason } = await classifySubmission(trimmed);
    // safe -> approved (auto-eligible, no owner involvement needed)
    // prohibited -> rejected (auto-rejected, never reaches DJ context)
    // ambiguous -> quarantined (owner exception queue)
    const status = statusForVerdict(verdict);
    const approvedAt = status === 'approved' ? new Date() : null;

    await sql`
      INSERT INTO messages (listener_name, message, category, status, safety_reason, approved_at)
      VALUES (${listenerName || null}, ${trimmed}, ${category}, ${status}, ${reason}, ${approvedAt})
    `;
    return Response.json({ ok: true });
  } catch (err) {
    console.error('Talk Wave message submission failed:', err);
    return Response.json({ error: 'Could not submit message.' }, { status: 500 });
  }
}
