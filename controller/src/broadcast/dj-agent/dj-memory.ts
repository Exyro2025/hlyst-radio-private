// Durable semantic shift memory â€” "did the DJ already do X recently?"
//
// Distinct from session.ts's chat window: that's turn-by-turn conversational
// history for the picker's short-term memory. This is coarser and longer-
// lived â€” a handful of named semantic facts (identified self, backsold an
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

// Human-readable summary for the decision prompt â€” only the recent, relevant
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