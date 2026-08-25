import { neon } from '@neondatabase/serverless';

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

    await sql`
      INSERT INTO messages (listener_name, message)
      VALUES (${listenerName || null}, ${message.trim()})
    `;

    return Response.json({ ok: true });
  } catch (err) {
    console.error('Talk Wave message submission failed:', err);
    return Response.json({ error: 'Could not submit message.' }, { status: 500 });
  }
}
