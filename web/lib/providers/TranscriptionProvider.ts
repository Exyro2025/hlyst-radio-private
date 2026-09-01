// TranscriptionProvider — the seam between the HLYST engine and whatever
// turns a voice note's audio into text. Call sites should import
// `transcriptionProvider` from here, never call a speech-to-text vendor
// directly. Mirrors VoiceProvider.ts's pattern.

export interface TranscribedWord {
  text: string;
  // Log-probability for this word, when the provider returns one — closer
  // to 0 is more confident, more negative is less confident. Absent when
  // the provider doesn't return word-level data.
  logprob?: number;
}

export interface TranscriptionOutcome {
  text: string;
  // 0–1 confidence that the detected language is correct, when provided.
  languageProbability: number | null;
  words: TranscribedWord[];
}

export interface TranscriptionProvider {
  readonly name: string;
  isConfigured(): boolean;
  // Returns null on any hard failure (not configured, network error, non-2xx
  // response) — the caller treats null exactly like a failed classification:
  // fail closed, never let a failure produce something that looks like success.
  transcribe(audio: Buffer, contentType: string): Promise<TranscriptionOutcome | null>;
}

export class ElevenLabsTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'elevenlabs';

  isConfigured(): boolean {
    return Boolean(process.env.ELEVENLABS_API_KEY);
  }

  async transcribe(audio: Buffer, contentType: string): Promise<TranscriptionOutcome | null> {
    if (!this.isConfigured()) return null;
    try {
      const form = new FormData();
      form.append('model_id', 'scribe_v1');
      form.append('file', new Blob([audio], { type: contentType || 'audio/webm' }), 'voice-note');
      form.append('timestamps_granularity', 'word');

      const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! },
        body: form,
      });
      if (!res.ok) return null;

      const body: any = await res.json();
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const languageProbability = typeof body.language_probability === 'number' ? body.language_probability : null;
      const words: TranscribedWord[] = Array.isArray(body.words)
        ? body.words
            .filter((w: any) => w?.type === 'word' && typeof w.text === 'string')
            .map((w: any) => ({ text: w.text, logprob: typeof w.logprob === 'number' ? w.logprob : undefined }))
        : [];

      return { text, languageProbability, words };
    } catch {
      return null;
    }
  }
}

export const transcriptionProvider: TranscriptionProvider = new ElevenLabsTranscriptionProvider();

// --- Confidence gate ---------------------------------------------------------
// "Transcription uncertainty must fail safely; do not let the DJ guess at
// unclear words, names or meaning." There's no reliable way to redact just
// the uncertain words without risking a garbled or misleading fragment for
// the DJ to paraphrase around — so the gate is whole-transcript: any real
// doubt fails the entire transcript, which the caller treats as a failed
// transcription (quarantined, same as a classification failure).
//
// Thresholds are a documented, conservative heuristic — there's no ground
// truth for "how uncertain is too uncertain" — biased toward failing safe
// over airing a guess.
const MIN_LANGUAGE_PROBABILITY = 0.6;
const MIN_AVG_WORD_LOGPROB = -1.0;
const MIN_SINGLE_WORD_LOGPROB = -2.5;

export function isTranscriptionConfident(outcome: TranscriptionOutcome): boolean {
  if (!outcome.text.trim()) return false;
  if (outcome.languageProbability !== null && outcome.languageProbability < MIN_LANGUAGE_PROBABILITY) return false;

  const logprobs = outcome.words
    .map((w) => w.logprob)
    .filter((v): v is number => typeof v === 'number');
  // No word-level data returned — fall back to the language-level gate only,
  // since there's nothing finer to check.
  if (!logprobs.length) return true;

  const avg = logprobs.reduce((a, b) => a + b, 0) / logprobs.length;
  if (avg < MIN_AVG_WORD_LOGPROB) return false;
  // A single very-uncertain word (very plausibly a name or detail) fails the
  // whole transcript — this is the "do not let the DJ guess at ... names"
  // requirement specifically.
  if (logprobs.some((lp) => lp < MIN_SINGLE_WORD_LOGPROB)) return false;

  return true;
}
