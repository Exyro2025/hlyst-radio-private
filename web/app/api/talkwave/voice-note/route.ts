import { put } from '@vercel/blob';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('audio') as File | null;
    const listenerName = formData.get('listenerName') as string | null;

    if (!file) {
      return Response.json({ error: 'No audio file provided.' }, { status: 400 });
    }

    // Basic sanity limits — real audio notes should be short.
    const MAX_BYTES = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_BYTES) {
      return Response.json({ error: 'Voice note is too large.' }, { status: 400 });
    }

    const filename = `talkwave/${Date.now()}-${crypto.randomUUID()}.webm`;

    const blob = await put(filename, file, {
      access: 'public',
      contentType: file.type || 'audio/webm',
    });

    await sql`
      INSERT INTO voice_notes (listener_name, audio_url)
      VALUES (${listenerName || null}, ${blob.url})
    `;

    return Response.json({ ok: true });
  } catch (err) {
    console.error('Talk Wave voice note submission failed:', err);
    return Response.json({ error: 'Could not submit voice note.' }, { status: 500 });
  }
}
