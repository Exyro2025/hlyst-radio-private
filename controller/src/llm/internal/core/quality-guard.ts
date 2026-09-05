// Deterministic quality backstop -- the LAST safety layer described in the DJ
// speech behavior spec. Prompting alone is not reliable on a small local
// model: it can hold the frame for stretches, then drift into written,
// literary, atmospheric prose ("summer's gentle squeeze still whispering
// through the air", "the lake's still calling"). This module is a cheap,
// deterministic check run AFTER generation, on every DJ speech call, that
// catches that drift and forces a regenerate -- never an air.
//
// This is NOT the primary personality/behavior system (the prompts in
// prompts/scripts.ts, dj-agent/schemas.ts, dj-agent/talk-decision.ts, and
// settings/persona.ts remain that). It is a backstop for when those fail.
//
// Layers, deliberately structural rather than an ever-growing exact-phrase
// list (a phrase list is always one rewording behind the model's next
// drift -- these patterns catch the underlying CONSTRUCTION, not just the
// specific words already observed):
//  1. BANNED_PHRASES / BANNED_WORDS -- near-verbatim matches on the specific
//     constructions the spec calls out by name.
//  2. PERSONIFICATION_PATTERN / STILL_LINGERING_PATTERN -- structural checks
//     for season/place nouns given human qualities.
//  3. SPATIAL_SIMILE_PATTERN -- a structural check for scene-setting via
//     simile ("the atmosphere inside must be musty, like old books and worn
//     couches") -- a different atmospheric-prose shape than personification,
//     built around a spatial/mood noun + copula + "like" within a short
//     window, not any specific vocabulary.
//  4. SELF_AS_LISTENER_PATTERN -- a structural identity check, not a prose-
//     style check: catches the on-air host describing themselves as tuning
//     in to / listening to their OWN station, which is categorically wrong
//     regardless of register (observed live: Winslow said "that's exactly
//     why I'm tuning in to HLYST" -- the host cannot be tuning in to the
//     show they are hosting).
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
// plain spoken DJ patter, so a single occurrence anywhere is enough -- this
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
// still" / "are still" -- this specific shape ("the heat's still bearable",
// "summer's still got a hold on us") is the single most common tell of
// lingering-mood prose in this failure mode, independent of which adjective
// or verb follows it.
const STILL_LINGERING_PATTERN =
  /\b(summer|winter|spring|autumn|fall|the lake|the city|the night|the air|the heat|the afternoon|the evening|the morning|the vibes?)('s|\s+is\b|\s+are\b)\s+still\b/i;

// A spatial/mood noun ("the atmosphere", "the room", "the space", "the
// place", "the mood") given a copula ("must be", "feels", "seems", "is"),
// followed within a short window by a simile marker ("like"). This is a
// DIFFERENT shape of atmospheric prose than personification above -- scene-
// setting built on concrete imagery via simile rather than on giving a
// season/place human qualities. Observed live (Winslow): "The atmosphere
// inside must be musty, like old books and worn couches, where stories get
// told in the dark." None of the vocabulary here ("atmosphere", "musty",
// "old books") appears in any list above, which is exactly why it slipped
// through -- this pattern catches the CONSTRUCTION instead.
const SPATIAL_SIMILE_PATTERN =
  /\b(the atmosphere|the room|the space|the place|the mood)\b[^.!?]{0,20}\b(must be|feels?|seems?|is)\b[^.!?]{0,40}\blike\b/i;

// The host describing themselves as tuning in to / listening to their OWN
// station -- an identity break, not a prose-style issue. Always wrong
// regardless of register: the DJ IS the show, they cannot be tuning in to
// it. Observed live (Winslow): "that's exactly why I'm tuning in to HLYST".
const SELF_AS_LISTENER_PATTERN =
  /\bI(?:'m|\s+am)\s+(?:tuning in to|tuned in to|listening to)\s+(?:HLYST|the station|this station)\b/i;

/**
 * Returns a short human-readable reason if `text` reads as literary/
 * atmospheric written prose rather than plain spoken DJ patter, or null if
 * it passes. Intentionally cheap (no model call) -- this runs on every DJ
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
  const spatialSimile = SPATIAL_SIMILE_PATTERN.exec(text);
  if (spatialSimile) return `spatial scene-setting via simile: "${spatialSimile[0]}"`;
  const selfAsListener = SELF_AS_LISTENER_PATTERN.exec(text);
  if (selfAsListener) return `identity break -- host describing self as a listener: "${selfAsListener[0]}"`;
  return null;
}

/**
 * Scans every string value in a plain object (one level of arrays included)
 * for atmospheric prose -- for djObject callers, where the speakable field's
 * key name varies by schema (say/text/ack/intro/...). Returns the first
 * reason found, or null. Non-string / non-speakable fields (ids, internal
 * "reason" scratchpads) are unlikely to trip this; the cost of scanning them
 * anyway is at most an unnecessary regenerate, never a missed atmospheric
 * line -- the safer direction to err for a last-layer backstop.
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
    super(`Generated line rejected by the quality backstop -- ${reason}`);
    this.name = 'AtmosphericProseError';
  }
}
