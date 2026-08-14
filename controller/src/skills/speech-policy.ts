// Central safety policy for listener-facing skill speech.
//
// Persona scriptLength remains a creative preference in the prompt, but these
// bounds make it an enforceable maximum before an LLM result can reach TTS.
// Skill briefs may always ask for LESS. They may not expand a skill past this
// envelope: a runaway string can otherwise consume the model's full global
// output allowance and then hand several thousand tokens to a local TTS model.

export type SkillSpeechMode = 'one-liner' | 'concise' | 'extended' | 'storyteller';

export interface SkillSpeechLimits {
  maxSentences: number;
  maxWords: number;
  maxChars: number;
  maxOutputTokens: number;
}

export interface SkillSpeechResult {
  text: string;
  clipped: boolean;
  originalChars: number;
  originalWords: number;
}

const LIMITS: Record<SkillSpeechMode, SkillSpeechLimits> = {
  'one-liner':  { maxSentences: 1, maxWords: 32,  maxChars: 220,  maxOutputTokens: 128 },
  concise:      { maxSentences: 3, maxWords: 80,  maxChars: 520,  maxOutputTokens: 256 },
  extended:     { maxSentences: 5, maxWords: 180, maxChars: 1200, maxOutputTokens: 512 },
  storyteller:  { maxSentences: 8, maxWords: 280, maxChars: 1800, maxOutputTokens: 768 },
};

export function skillSpeechMode(persona: unknown): SkillSpeechMode {
  const mode = (persona as { scriptLength?: unknown } | null | undefined)?.scriptLength;
  return typeof mode === 'string' && Object.hasOwn(LIMITS, mode)
    ? mode as SkillSpeechMode
    : 'concise';
}

export function skillSpeechLimits(persona: unknown): SkillSpeechLimits {
  return LIMITS[skillSpeechMode(persona)];
}

function words(text: string): string[] {
  return text.match(/\S+/gu) ?? [];
}

function clean(text: unknown): string {
  return String(text ?? '').replace(/\s+/gu, ' ').trim();
}

function sentenceParts(text: string): string[] {
  // Intl.Segmenter handles closing quotes and common abbreviations much better
  // than a punctuation regex. Fall back for unusually old Node runtimes.
  try {
    const Segmenter = Intl.Segmenter;
    if (typeof Segmenter === 'function') {
      return [...new Segmenter(undefined, { granularity: 'sentence' }).segment(text)]
        .map(part => String(part.segment).trim())
        .filter(Boolean);
    }
  } catch {
    // Fall through to the conservative punctuation splitter below.
  }
  return text.match(/[^.!?…]+(?:[.!?…]+["'’”)]*|$)/gu)?.map(s => s.trim()).filter(Boolean) ?? [text];
}

function clipAtWord(text: string, maxWords: number, maxChars: number): string {
  const out: string[] = [];
  let chars = 0;
  for (const word of words(text)) {
    if (out.length >= maxWords) break;
    const next = chars + (out.length ? 1 : 0) + word.length;
    if (next > maxChars - 1) break; // reserve one character for the ellipsis
    out.push(word);
    chars = next;
  }
  const joined = out.join(' ').replace(/[\s,;:—-]+$/u, '').trim();
  return joined ? `${joined}…` : '';
}

export function enforceSkillSpeech(text: unknown, persona: unknown): SkillSpeechResult {
  const original = clean(text);
  const originalWords = words(original).length;
  const limits = skillSpeechLimits(persona);
  if (!original) return { text: '', clipped: false, originalChars: 0, originalWords: 0 };

  const sentences = sentenceParts(original);
  const accepted: string[] = [];
  let acceptedWords = 0;
  let acceptedChars = 0;

  for (const sentence of sentences.slice(0, limits.maxSentences)) {
    const sentenceWords = words(sentence).length;
    const nextChars = acceptedChars + (accepted.length ? 1 : 0) + sentence.length;
    if (acceptedWords + sentenceWords > limits.maxWords || nextChars > limits.maxChars) break;
    accepted.push(sentence);
    acceptedWords += sentenceWords;
    acceptedChars = nextChars;
  }

  let bounded = accepted.join(' ').trim();
  if (!bounded) bounded = clipAtWord(original, limits.maxWords, limits.maxChars);
  const clipped = bounded !== original;
  return { text: bounded, clipped, originalChars: original.length, originalWords };
}
