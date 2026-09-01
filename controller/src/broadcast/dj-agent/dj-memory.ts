// Durable semantic shift memory — "did the DJ already do X recently?"
//
// Distinct from session.ts's chat window: that's turn-by-turn conversational
// history for the picker's short-term memory. This is coarser and longer-
// lived — a handful of named semantic facts (identified self, backsold an
// artist, mentioned the next DJ) that need to persist ACROSS session rolls
// so the DJ doesn't repeat the same meaning every shift boundary.
//
// Same persistence shape as session.ts/queue.ts: debounced atomic write,
// capped array, survives a controller restart.

import { existsSync, readFileSync } from 'node:fs';
import { config } from '../../config.js';
import { writeFileAtomic } from '../../util/atomic-file.js';

interface MemoryEvent {
  kind: string;        // a BreakPurpose, or a free-form event name
  subject?: string;     // e.g. an artist name, for kind-scoped recency checks
  t: number;             // epoch ms
}

const MAX_EVENTS = 200;
const FILE = `${config.session.dir}/../dj-memory.json`;

let events: MemoryEvent[] = [];
let writeTimer: NodeJS.Timeout | null = null;

function load() {
  if (!existsSync(FILE)) return;
  try {
    const stored = JSON.parse(readFileSync(FILE, 'utf8'));
    if (Array.isArray(stored)) events = stored.slice(-MAX_EVENTS);
  } catch { /* start fresh */ }
}
load();

function schedulePersist() {
  if (writeTimer) return;
  writeTimer = setTimeout(async () => {
    writeTimer = null;
    try { await writeFileAtomic(FILE, JSON.stringify(events, null, 2)); } catch {}
  }, 1000);
}

export function recordEvent(kind: string, opts: { subject?: string; text?: string } = {}) {
  events.push({ kind, subject: opts.subject, t: Date.now() });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  schedulePersist();
}

// Has this kind (optionally scoped to a subject) happened within withinMs?
export function recentlyDid(kind: string, withinMs: number, subject?: string): boolean {
  const cutoff = Date.now() - withinMs;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.t < cutoff) break;
    if (e.kind !== kind) continue;
    if (subject && e.subject !== subject) continue;
    return true;
  }
  return false;
}

// Human-readable summary for the decision prompt — only the recent, relevant
// facts, so the model can avoid repeating meaning without being handed the
// raw event log.
export function memoryClauseForPrompt(): string {
  const bits: string[] = [];
  const ago = (ms: number) => {
    const min = Math.round(ms / 60000);
    return min < 60 ? `${min}m ago` : `${Math.round(min / 60)}h ago`;
  };
  const lastOf = (kind: string) => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].kind === kind) return events[i];
    }
    return null;
  };
  for (const kind of ['STATION_BUSINESS', 'HANDOFF', 'BACKSELL', 'PROGRAMMING']) {
    const e = lastOf(kind);
    if (e) bits.push(`You last did a ${kind} break ${ago(Date.now() - e.t)}.`);
  }
  return bits.length ? bits.join(' ') : 'No relevant recent talk breaks recorded.';
}

// --- Local vernacular usage tracking (The Lyst Coast / The 1-6) ----------
// Optional station vocabulary, never mandatory, never a Cleveland
// replacement. Tracked so the same expression doesn't repeat too closely
// and the two never land in the same break together.
const VERNACULAR_COOLDOWN_MS = 45 * 60_000;

export function vernacularClause(): string {
  const lystCoastRecent = recentlyDid('VERNACULAR_LYST_COAST', VERNACULAR_COOLDOWN_MS);
  const the16Recent = recentlyDid('VERNACULAR_1_6', VERNACULAR_COOLDOWN_MS);
  const base = 'Optional local vernacular, use ORGANICALLY only when it genuinely fits — never forced, never a substitute for the word Cleveland, never both in the same break, never explained on air: "The Lyst Coast" (HLYST\'s own branded identity for the Cleveland/home area) and "The 1-6" (casual local shorthand). Never say "the 216" — it is not HLYST\'s vernacular; if local shorthand does not fit, just say Cleveland.';
  if (lystCoastRecent && the16Recent) {
    return `${base} You used BOTH recently — skip local vernacular entirely this break; just say Cleveland if you need to.`;
  }
  if (lystCoastRecent) {
    return `${base} You used "The Lyst Coast" recently — if vernacular fits, reach for "The 1-6" instead, or just say Cleveland.`;
  }
  if (the16Recent) {
    return `${base} You used "The 1-6" recently — if vernacular fits, reach for "The Lyst Coast" instead, or just say Cleveland.`;
  }
  return base;
}

// Scans actually-aired text so tracking reflects what was really said, not
// merely what was permitted.
export function recordVernacularUsage(text: string) {
  if (/\blyst coast\b/i.test(text)) recordEvent('VERNACULAR_LYST_COAST');
  if (/\bthe 1-6\b|\bthe one[\s-]six\b/i.test(text)) recordEvent('VERNACULAR_1_6');
}


// --- Cross-process transition claims (DJ HANDOFF vs Vince imaging) --------
// "This DJ's upcoming/just-happened changeover has already been promoted by
// ONE of the two systems that can cover it" — the outgoing DJ's own HANDOFF
// break (talk-decision.ts), or Vince Morgan imaging fired opportunistically
// by HLYST's engine-tick. Both sides reach this through the same 'HANDOFF'
// event kind already used above, scoped by a subject (the incoming DJ's
// name) rather than a second store — SUB/WAVE checks/claims in-process,
// HLYST checks/claims over HTTP via controller/src/routes/hlyst-bridge.ts's
// /hlyst/transition-claim endpoint, which just calls these two functions.
//
// The window is generous on purpose: it has to span the DJ's own ~1hr
// HANDOFF lead-up through the boundary itself, where Vince's opportunistic
// check happens. A DJ is never scheduled onto air twice inside that span, so
// keying on name alone (no explicit date/time) is enough to mean "this
// specific changeover" without either system introducing a second schedule.
export const TRANSITION_CLAIM_WINDOW_MS = 3 * 60 * 60_000;

export function transitionKey(targetPersonaName: string): string {
  return targetPersonaName.trim().toLowerCase();
}

export function transitionClaimed(key: string): boolean {
  return recentlyDid('HANDOFF', TRANSITION_CLAIM_WINDOW_MS, key);
}

export function claimTransition(key: string) {
  recordEvent('HANDOFF', { subject: key });
}


// List of active/recent transition claims, newest first — feeds the debug
// panel's shared-airtime view. Same 'HANDOFF' event kind and window as
// transitionClaimed() above; this just enumerates instead of testing one key.
export function recentTransitionClaims(withinMs: number = TRANSITION_CLAIM_WINDOW_MS): Array<{ subject: string; t: number; ageMs: number }> {
  const cutoff = Date.now() - withinMs;
  const out: Array<{ subject: string; t: number; ageMs: number }> = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.t < cutoff) break;
    if (e.kind !== 'HANDOFF' || !e.subject) continue;
    out.push({ subject: e.subject, t: e.t, ageMs: Date.now() - e.t });
  }
  return out;
}


// --- Recognized names (institutional knowledge) -----------------------------
// Established people within the HLYST world the DJs should recognize BY NAME
// — "I know who that is" — without that recognition becoming a license to
// disclose private/administrative facts or invent anything not listed here.
//
// Each entry's `recognitionNote` is the ONLY approved fact surface for that
// person. It is written to be read aloud in the system prompt as-is, so it
// already carries its own boundary ("don't mention X") rather than leaving
// the model to infer what's off-limits.
//
// This list is general DJ knowledge — always present, every generation call.
// A program (e.g. a future Lystenne interview-segment module) MAY layer
// additional approved facts on top of this for the duration of that program,
// but those facts are program-scoped and must NOT be folded back into this
// list — general DJ knowledge stays permanent-and-approved only.
export interface RecognizedPerson {
  name: string;
  recognitionNote: string;
}

export const RECOGNIZED_PEOPLE: RecognizedPerson[] = [
  {
    name: 'Australia Lawrence',
    recognitionNote: 'An important person within the HLYST world, with a meaningful creative/institutional relationship to the station. Never mention or imply ownership, JH Broadcast Group ownership, corporate structure, or any administrative/business relationship — those are not approved for on-air use, even if true.',
  },
  {
    name: 'Christopher',
    recognitionNote: 'Recognized within the established HLYST/Lystenne context. No surname, title, business role, private relationship, or additional biography is known — do not invent one.',
  },
  {
    name: 'Jalen Edwards',
    recognitionNote: 'Recognized according to his approved HLYST/music context. No additional history or interactions beyond that are known — do not invent any.',
  },
];

export function recognizedNamesClause(): string {
  if (!RECOGNIZED_PEOPLE.length) return '';
  const lines = RECOGNIZED_PEOPLE.map((p) => `- ${p.name}: ${p.recognitionNote}`).join('\n');
  return `RECOGNIZED NAMES — people established within the HLYST world. If one of
these names comes up, you know who they are; never treat them as an unknown
stranger. Recognition means "I know who that is" — it does NOT mean
disclosing everything below to the audience, and it does NOT license
inventing conversations, friendships, meetings, quotes, preferences,
memories, or personal relationships with them beyond what's listed. State
only what's explicitly given for each person below — never add a surname,
title, role, relationship, or backstory beyond it.
${lines}

Keep "A JH Broadcast" as normal public station language, but never connect
JH Broadcast Group or Jerailian House to Australia Lawrence in anything you
generate.`;
}
