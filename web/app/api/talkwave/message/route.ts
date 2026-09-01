import { neon } from '@neondatabase/serverless';
import { callLLM } from '@/lib/llm.server';

// Forces dynamic rendering — this route hits the DB at module load
// (const sql = neon(...)) and must never be statically evaluated at
// Docker build time, when TALKWAVE_URL_POSTGRES_URL isn't set.
export const dynamic = 'force-dynamic';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

const CATEGORIES = ['request', 'shout-out', 'dedication', 'comment', 'question', 'other'];

// Classifies the submission's category and judges whether it's clearly safe
// to auto-approve. The model is asked for JSON and the result is parsed
// defensively: any parse failure, missing field, or explicit "not safe"
// verdict falls back to quarantine — never auto-approve on an uncertain
// read. This is the fail-safe boundary the brief requires (questionable,
// abusive, sexual, threatening, personally identifying, suspicious, or
// UNCERTAIN material must be quarantined, never exposed to DJ context).
async function classifySubmission(message: string): Promise<{ category: string; safe: boolean; reason: string }> {
  const fallback = { category: 'other', safe: false, reason: 'classification failed — quarantined by default' };
  try {
    const system = `You moderate listener submissions for a radio station's Talk Wave feature.
Classify the submission and judge whether it's CLEARLY safe to air. Respond with ONLY a
JSON object, no other text: {"category": one of ${JSON.stringify(CATEGORIES)}, "safe": true
or false, "reason": one short sentence}.

"safe": true ONLY if the message is unambiguously fine — a normal request, shout-out,
dedication, comment, or question. Set "safe": false for ANYTHING abusive, sexual,
threatening, containing someone's personal identifying information (address, phone
number, full name of a third party in a negative context), suspicious, or where you are
at all uncertain. When in doubt, "safe": false — a human will review it.`;
    const { text } = await callLLM(system, `Submission: "${message}"`);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]);
    const category = CATEGORIES.includes(parsed.category) ? parsed.category : 'other';
    const safe = parsed.safe === true;
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 300) : '';
    return { category, safe, reason };
  } catch {
    return fallback;
  }
}

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
    const { category, safe, reason } = await classifySubmission(trimmed);
    // Clearly safe ? approved immediately (brief: "Clearly safe material may
    // be automatically approved"). Anything else ? quarantined, which is
    // structurally invisible to engine-tick's status='approved' filter, so
    // it never reaches DJ broadcast context until an owner reviews it.
    const status = safe ? 'approved' : 'quarantined';

    await sql`
      INSERT INTO messages (listener_name, message, category, status, safety_reason)
      VALUES (${listenerName || null}, ${trimmed}, ${category}, ${status}, ${reason})
    `;
    return Response.json({ ok: true });
  } catch (err) {
    console.error('Talk Wave message submission failed:', err);
    return Response.json({ error: 'Could not submit message.' }, { status: 500 });
  }
}
