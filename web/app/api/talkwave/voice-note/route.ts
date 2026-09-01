import { neon } from '@neondatabase/serverless';
import { storageProvider } from '@/lib/providers/StorageProvider';
import { transcriptionProvider, isTranscriptionConfident } from '@/lib/providers/TranscriptionProvider';
import { classifySubmission, statusForVerdict } from '@/lib/talkwaveModeration';

// Forces dynamic rendering — this route hits the DB at module load
// (const sql = neon(...)) and must never be statically evaluated at
// Docker build time, when TALKWAVE_URL_POSTGRES_URL isn't set.
export const dynamic = 'force-dynamic';

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

    const contentType = file.type || 'audio/webm';
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `talkwave/${Date.now()}-${crypto.randomUUID()}.webm`;
    const audioUrl = await storageProvider.put(filename, buffer, contentType);

    // Transcribe, then run the audio through the SAME moderation pipeline
    // text messages use (classifySubmission/statusForVerdict) — no parallel
    // moderation logic. A transcription failure or low-confidence result
    // fails exactly like a classification failure: quarantined, never
    // approved, never left for the DJ to guess at.
    const outcome = await transcriptionProvider.transcribe(buffer, contentType);
    const transcribedOk = !!outcome && isTranscriptionConfident(outcome);

    let transcript: string | null = null;
    let transcriptStatus: 'ok' | 'low_confidence' | 'failed';
    let category = 'other';
    let status: 'approved' | 'rejected' | 'quarantined' = 'quarantined';
    let safetyReason: string;

    if (!outcome) {
      transcriptStatus = 'failed';
      safetyReason = 'transcription failed — quarantined by default';
    } else if (!transcribedOk) {
      transcript = outcome.text || null;
      transcriptStatus = 'low_confidence';
      safetyReason = 'transcription confidence too low — quarantined so a human can listen and decide, rather than let the DJ guess at unclear words';
    } else {
      transcript = outcome.text;
      transcriptStatus = 'ok';
      const { category: c, verdict, reason } = await classifySubmission(outcome.text);
      category = c;
      status = statusForVerdict(verdict);
      safetyReason = reason;
    }

    const approvedAt = status === 'approved' ? new Date() : null;

    await sql`
      INSERT INTO voice_notes (listener_name, audio_url, transcript, transcript_status, category, status, safety_reason, approved_at)
      VALUES (${listenerName || null}, ${audioUrl}, ${transcript}, ${transcriptStatus}, ${category}, ${status}, ${safetyReason}, ${approvedAt})
    `;

    return Response.json({ ok: true });
  } catch (err) {
    console.error('Talk Wave voice note submission failed:', err);
    return Response.json({ error: 'Could not submit voice note.' }, { status: 500 });
  }
}
