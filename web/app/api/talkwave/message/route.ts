import { neon } from '@neondatabase/serverless';
import { callLLM } from '@/lib/llm.server';

export const dynamic = 'force-dynamic';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

const CATEGORIES = ['request', 'shout-out', 'dedication', 'comment', 'question', 'other'];

// Three-state moderation: safe -> auto-approved, clearly prohibited ->
// auto-rejected, ambiguous/uncertain/failure -> quarantined for owner
// review. Fails closed: any parse failure or unrecognized verdict lands in
// quarantine, never approved.
async function classifySubmission(message: string): Promise<{ category: string; verdict: 'safe' | 'prohibited' | 'ambiguous'; reason: string }> {
  const fallback = { category: 'other', verdict: 'ambiguous' as const, reason: 'classification failed — quarantined by default' };
  try {
    const system = `You moderate listener submissions for a radio station's Talk Wave feature.
Classify the submission and judge it. Respond with ONLY a JSON object, no other text:
{"category": one of ${JSON.stringify(CATEGORIES)}, "verdict": "safe" | "prohibited" | "ambiguous", "reason": one short sentence}.

"safe" ONLY if the message is unambiguously fine — a normal request, shout-out, dedication,
comment, or question.
"prohibited" if it is CLEARLY abusive, sexual, threatening, hate speech, or contains someone's
personal identifying information (address, phone number, full name of a third party in a
negative context) — content a reasonable moderator would reject outright, not merely question.
"ambiguous" for anything else you are not fully certain about — borderline, unclear intent,
or anything a human should look at before it airs. When in doubt between "prohibited" and
"ambiguous", choose "ambiguous" — false auto-rejects are worse than a human review.`;
    const { text } = await callLLM(system, `Submission: "${message}"`);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]);
    const category = CATEGORIES.includes(parsed.category) ? parsed.category : 'other';
    const verdict = ['safe', 'prohibited', 'ambiguous'].includes(parsed.verdict) ? parsed.verdict : 'ambiguous';
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 300) : '';
    return { category, verdict, reason };
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
    const { category, verdict, reason } = await classifySubmission(trimmed);
    // safe -> approved (auto-eligible, no owner involvement needed)
    // prohibited -> rejected (auto-rejected, never reaches DJ context)
    // ambiguous -> quarantined (owner exception queue)
    const status = verdict === 'safe' ? 'approved' : verdict === 'prohibited' ? 'rejected' : 'quarantined';

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