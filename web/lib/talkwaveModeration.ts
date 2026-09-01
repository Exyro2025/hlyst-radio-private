// Talk Wave's ONE moderation function — shared by every submission type
// (text messages, voice-note transcripts, and any future type). Never
// duplicate this logic per-type; import and call this instead.
//
// Three-state moderation: safe -> auto-approved, clearly prohibited ->
// auto-rejected, ambiguous/uncertain/failure -> quarantined for owner
// review. Fails closed: any parse failure or unrecognized verdict lands in
// quarantine, never approved.
import { callLLM } from './llm.server';

export const TALKWAVE_CATEGORIES = ['request', 'shout-out', 'dedication', 'comment', 'question', 'other'];

export interface ClassificationResult {
  category: string;
  verdict: 'safe' | 'prohibited' | 'ambiguous';
  reason: string;
}

export async function classifySubmission(text: string): Promise<ClassificationResult> {
  const fallback: ClassificationResult = { category: 'other', verdict: 'ambiguous', reason: 'classification failed — quarantined by default' };
  try {
    const system = `You moderate listener submissions for a radio station's Talk Wave feature.
Classify the submission and judge it. Respond with ONLY a JSON object, no other text:
{"category": one of ${JSON.stringify(TALKWAVE_CATEGORIES)}, "verdict": "safe" | "prohibited" | "ambiguous", "reason": one short sentence}.

"safe" ONLY if the message is unambiguously fine — a normal request, shout-out, dedication,
comment, or question.
"prohibited" if it is CLEARLY abusive, sexual, threatening, hate speech, or contains someone's
personal identifying information (address, phone number, full name of a third party in a
negative context) — content a reasonable moderator would reject outright, not merely question.
"ambiguous" for anything else you are not fully certain about — borderline, unclear intent,
or anything a human should look at before it airs. When in doubt between "prohibited" and
"ambiguous", choose "ambiguous" — false auto-rejects are worse than a human review.`;
    const { text: raw } = await callLLM(system, `Submission: "${text}"`);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]);
    const category = TALKWAVE_CATEGORIES.includes(parsed.category) ? parsed.category : 'other';
    const verdict = ['safe', 'prohibited', 'ambiguous'].includes(parsed.verdict) ? parsed.verdict : 'ambiguous';
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 300) : '';
    return { category, verdict, reason };
  } catch {
    return fallback;
  }
}

// Shared status mapping — the SAME rule for every submission type: safe
// verdicts go live without owner involvement, prohibited content never
// reaches DJ context, everything else waits for a human.
export function statusForVerdict(verdict: ClassificationResult['verdict']): 'approved' | 'rejected' | 'quarantined' {
  return verdict === 'safe' ? 'approved' : verdict === 'prohibited' ? 'rejected' : 'quarantined';
}
