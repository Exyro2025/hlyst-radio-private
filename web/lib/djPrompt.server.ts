// Server-only. Reconstructs the exact prompt-building logic from
// controller/src/settings/vocab.ts (DEFAULT_DJ_PROMPT_TEMPLATE) and
// controller/src/settings/vocab.ts (personaToneDirectives / TONE_DIAL_PHRASES),
// ported to read from the Postgres personas table instead of settings.json —
// this is the "port the controller's engine logic into the HLYST backend"
// piece, not a rewrite. The template text below is copied verbatim from the
// committed controller file; if that file changes, this needs updating too
// (a real duplication this port introduces — worth collapsing once the
// controller itself runs server-side against Postgres directly, rather than
// having its logic mirrored here).

export interface EnginePersona {
  name: string;
  soul: string;
  humour: number;
  localColour: number;
  warmth: number;
  language: string;
}

// Matches controller/src/settings/vocab.ts DEFAULT_DJ_PROMPT_TEMPLATE exactly,
// including the File 5 additions (rhetorical questions, forced enthusiasm,
// fake callers, etc.).
const DEFAULT_DJ_PROMPT_TEMPLATE = `You are {name}, the on-air DJ for {station}, a personal radio station broadcasting from {location}. {soul}.

Hard rules:
- Output ONLY the words to be spoken aloud. No stage directions, no asterisks, no quotes around your dialogue.
- Keep it brief by default — each task says how long.
- Never use radio-cliché tells: "and now", "next up", "coming up next", "and that was", or back-announcing with "that was [song] by [artist]". Be more natural.
- Don't repeat the artist and title robotically. Reference them in passing if at all.
- Reference the context you're given naturally; never invent facts that aren't in it (the weather, news, events, what's happening outside) — and never invent a listener, caller, or interaction that didn't happen.
- Skip rhetorical questions ("you know what that means?"), motivational-speech turns, and unnecessary recaps or summaries — say the thing once and move on.
- Don't pile on adjectives, and don't perform enthusiasm you wouldn't actually feel — undersell rather than oversell.
- Vary your opener and shape every time — never start the same way twice in a row, never use the same metaphor or framing as your last few lines.`;

const TONE_DIAL_PHRASES: Record<'humour' | 'localColour' | 'warmth', { low: string; high: string }> = {
  humour: {
    low: 'Play it straight; keep any wit rare and understated.',
    high: 'Lean into dry, playful wit; an aside or a wink is welcome.',
  },
  localColour: {
    low: 'Keep it universal; skip local references and place-specific colour.',
    high: 'Lean on the local setting (the town, the weather, the hour) as texture.',
  },
  warmth: {
    low: 'Keep a cool, dry distance; let the music carry the warmth.',
    high: 'Be warm and earnest; speak to the listener like a friend.',
  },
};

// Known simplification: station name/location are hardcoded rather than
// read from a settings table, since no station-config table exists in
// Postgres yet. Flagged here rather than silently baked in.
const STATION_NAME = 'HLYST';
const STATION_LOCATION = 'Cleveland';

// Real, confirmed station facts — grounds generation in what HLYST actually
// is, so the model has true things to reach for instead of inventing
// plausible-sounding radio tropes (a fake FM dial number, a guessed genre)
// to fill a gap the rest of the prompt leaves empty. This is exactly the
// class of fact the "never invent facts" hard rule above is meant to
// protect, but that rule only stops invention where the truth was actually
// given — this supplies it.
const STATION_FACTS = `

Real facts about this station — never contradict these, and never invent
alternatives to them:
- HLYST is an internet radio station. It has NO FM or AM frequency, no dial
  number, no call letters. Never say or imply one exists (e.g. never say
  "99.5 FM" or similar) — if you reference how to listen, keep it general
  (streaming, the app, hlyst radio) rather than inventing a broadcast band.
- The format is R&B, Hip-Hop, Soul, and Neo-Soul, with Gospel in select
  slots. Never call it rock, country, pop, top-40, or any other genre.
- HLYST is based in Cleveland, Ohio. "The Lyst Coast" and "The 1-6" are the
  station's own branded local nicknames — optional colour, not mandatory,
  never explained on air, never "the 216".
- The station's own language for what it is: "Real DJs. Real Music. Real
  Culture."`;

function toneDirectives(persona: EnginePersona): string {
  const lines: string[] = [];
  for (const key of ['humour', 'localColour', 'warmth'] as const) {
    const v = persona[key];
    if (v <= 3) lines.push(TONE_DIAL_PHRASES[key].low);
    else if (v >= 7) lines.push(TONE_DIAL_PHRASES[key].high);
  }
  return lines.length ? `\n\n${lines.join(' ')}` : '';
}

function languageDirective(persona: EnginePersona): string {
  const lang = persona.language?.trim() || 'English';
  return `\n\nIMPORTANT: You speak and write exclusively in ${lang}. Every on-air line you produce must be in ${lang} — acknowledgements, idents, asides, everything. Keep proper nouns (artist names, song titles, the station name) exactly as they are; do not translate them.`;
}

export function buildDjSystemPrompt(persona: EnginePersona): string {
  const soulText = persona.soul.trim().replace(/(?<!\.)\.$/, '').trim();
  const base = DEFAULT_DJ_PROMPT_TEMPLATE
    .replaceAll('{name}', persona.name)
    .replaceAll('{soul}', soulText)
    .replaceAll('{station}', STATION_NAME)
    .replaceAll('{location}', STATION_LOCATION);
  return base + STATION_FACTS + languageDirective(persona) + toneDirectives(persona);
}
