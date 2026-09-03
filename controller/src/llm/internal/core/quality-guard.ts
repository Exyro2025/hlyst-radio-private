// Deterministic quality backstop — the LAST safety layer described in the DJ
// speech behavior spec. Prompting alone is not reliable on a small local
// model: it can hold the frame for stretches, then drift into written,
// literary, atmospheric prose ("summer's gentle squeeze still whispering
// through the air", "the lake's still calling"). This module is a cheap,
// deterministic check run AFTER generation, on every DJ speech call, that
// catches that drift and forces a regenerate — never an air.
//
// This is NOT the primary personality/behavior system (the prompts in
// prompts/scripts.ts, dj-agent/schemas.ts, dj-agent/talk-decision.ts, and
// settings/persona.ts remain that). It is a backstop for when those fail.
//
// Two layers, deliberately:
//  1. BANNED_PHRASES / BANNED_WORDS — near-verbatim matches on the specific
//     constructions the spec calls out by name.
//  2. PERSONIFICATION_PATTERN — a structural check, not a word list. This is
//     what catches paraphrases of the same failure the exact strings above
//     would miss (a season/place noun given a possessive or "is/has", then an
//     atmosphere verb) — "prevent the underlying writing style", not just the
//     exact strings already seen.

const BANNED_PHRASES: string[] = [
  "there's something about",
  'the kind of record that',
  'music has a way',
  'as we continue',
  'let that breathe',
  'setting the tone',
  'soundtrack to',
  'stay right here',
  'more great music',
  'the vibe is',
  'the vibe here',
  'the vibes are',
  'the energy is',
  'the energy in',
  'the energy of',
  'still feeling like',
  'still feels like',
  'letting up, but',
];

// Standalone literary-register words. These essentially never belong in
// plain spoken DJ patter, so a single occurrence anywhere is enough — this
// backstop is meant to over-reject in favor of NO_BREAK/regenerate, never to
// air a line that hedges close to the line.
const BANNED_WORDS: string[] = [
  'languid',
  'whisper',
  'whispers',
  'whispering',
  'linger',
  'lingers',
  'lingering',
  'resonate',
  'resonates',
  'resonating',
  'unfurl',
  'unfurls',
  'unfurling',
  'cradle',
  'cradles',
  'cradling',
  'embrace',
  'embraces',
  'embracing',
];

// Season/place noun, given a possessive or "is/has", followed (within a short
// window) by an atmosphere verb or phrase. Catches "summer's gentle squeeze
// still whispering through the air" and "the lake's still calling" even
// though neither matches a banned phrase/word list above verbatim.
const PERSONIFICATION_PATTERN =
  /\b(summer|winter|spring|autumn|fall|the lake|the city|the night|the air|the heat|the afternoon|the evening|the morning|the vibes?)('s|\s+is\b|\s+are\b|\s+has\b)[^.!?]{0,40}\b(whisper\w*|linger\w*|resonat\w*|breath\w*|unfurl\w*|embrac\w*|cradl\w*|hum(?:ming)? of|still alive|still calling|calling us|settl\w*\s+(?:into|over))\b/i;

// A season/place/atmosphere noun immediately followed by "'s still" / "is
// still" / "are still" — this specific shape ("the heat's still bearable",
// "summer's still got a hold on us") is the single most common tell of
// lingering-mood prose in this failure mode, independent of which adjective
// or verb follows it.
const STILL_LINGERING_PATTERN =
  /\b(summer|winter|spring|autumn|fall|the lake|the city|the night|the air|the heat|the afternoon|the evening|the morning|the vibes?)('s|\s+is\b|\s+are\b)\s+still\b/i;

/**
 * Returns a short human-readable reason if `text` reads as literary/
 * atmospheric written prose rather than plain spoken DJ patter, or null if
 * it passes. Intentionally cheap (no model call) — this runs on every DJ
 * speech generation.
 */
export function atmosphericProseReason(text: string | null | undefined): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) return `banned phrase: "${phrase}"`;
  }
  for (const word of BANNED_WORDS) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) return `literary word: "${word}"`;
  }
  const personification = PERSONIFICATION_PATTERN.exec(text);
  if (personification) return `personification: "${personification[0]}"`;
  const stillLingering = STILL_LINGERING_PATTERN.exec(text);
  if (stillLingering) return `lingering-mood construction: "${stillLingering[0]}"`;
  return null;
}

/**
 * Scans every string value in a plain object (one level of arrays included)
 * for atmospheric prose — for djObject callers, where the speakable field's
 * key name varies by schema (say/text/ack/intro/...). Returns the first
 * reason found, or null. Non-string / non-speakable fields (ids, internal
 * "reason" scratchpads) are unlikely to trip this; the cost of scanning them
 * anyway is at most an unnecessary regenerate, never a missed atmospheric
 * line — the safer direction to err for a last-layer backstop.
 */
export function atmosphericProseReasonInObject(obj: unknown): string | null {
  if (obj == null) return null;
  if (typeof obj === 'string') return atmosphericProseReason(obj);
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = atmosphericProseReasonInObject(v);
      if (r) return r;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      const r = atmosphericProseReasonInObject(v);
      if (r) return r;
    }
  }
  return null;
}

export class AtmosphericProseError extends Error {
  constructor(reason: string) {
    super(`Generated line rejected by the quality backstop — ${reason}`);
    this.name = 'AtmosphericProseError';
  }
}
