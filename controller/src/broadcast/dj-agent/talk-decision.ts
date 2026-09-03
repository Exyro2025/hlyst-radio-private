// Autonomous talk decision — the two-stage break engine.
//
// Stage 1 (decideBreak): given real station context, decide WHETHER the DJ
// should speak right now, and if so WHY (one purpose from the taxonomy below).
// A song ending is not itself a reason to talk — the model is explicitly told
// this, and "nothing useful to say" is a legitimate, expected answer (NO_BREAK).
//
// Stage 2 (generateBreakCopy): only runs when stage 1 chose a real purpose.
// Writes the actual on-air line for that purpose, under the same constraints
// every DJ generator in this codebase already follows (concise, in character,
// never invents facts).
//
// This module does NOT decide the pick/link that rides WITH a track (that's
// dj-agent.ts's wantLink path, unchanged). It decides STANDALONE breaks —
// station business, backsells, personality moments, the next-DJ lead-up —
// the same category of segment idents/hourly/weather already are. It reuses
// queue.announceAtNextTrack(), which already renders ahead of the boundary
// and defers airing to the next track start — satisfying #7 (pre-rendering)
// for free, the same way idents already work.
//
// Frequency (#9) is a NO-MODEL-CALL gate that runs first: outside the target
// window, we never even ask the LLM. This keeps "3-5 breaks/hour, not a
// quota" honest and cheap. It has TWO parts, not one:
//  - a floor keyed off the last REAL break that aired (queue.getLastTalkBreakAt),
//    which is what actually paces breaks/hour once the DJ has spoken;
//  - a floor keyed off the last DECISION made, of ANY outcome (below), which
//    is what stops a long run of NO_BREAK answers from collapsing the gate
//    into asking the model on every watcher tick (~every 2-3 min) instead of
//    once per target gap — that collapse is what happened before this fix: 36
//    model calls in 90 minutes, all but structurally guaranteed to be NO_BREAK
//    at that frequency, because getLastTalkBreakAt() never advances until
//    something actually airs.
//
// HANDOFF coordination: this is the one purpose HLYST's Vince Morgan imaging
// (engine-tick's VM auto-trigger) can ALSO cover, for the exact same DJ
// changeover. dj-memory.ts's transition-claim functions (shared with
// controller/src/routes/hlyst-bridge.ts's /hlyst/transition-claim endpoint)
// are the one place both systems check/record "has this transition already
// been covered" — the DJ's own HANDOFF gets priority simply by running here
// first (it fires on its own ~1hr lead-up, ahead of Vince's boundary-triggered
// opportunistic check); if Vince got there first, this backs off instead of
// doubling up.

import { z } from 'zod';
import * as settings from '../../settings.js';
import { djObject } from '../../llm/sdk.js';
import * as memory from './dj-memory.js';
import * as talkwave from './talkwave-store.js';
import type { SessionContext } from '../session.js';
import * as session from '../session.js';
import * as emergencyMode from '../emergency-mode.js';
export const BREAK_PURPOSES = [
  'NO_BREAK',
  'BACKSELL',
  'FORWARD_TEASE',
  'RESET',
  'INTRO',
  'LISTENER',
  'PROGRAMMING',
  'STATION_BUSINESS',
  'MUSIC_NOTE',
  'PERSONALITY_MOMENT',
  'HANDOFF',
  'LIVE_INFO',
] as const;
export type BreakPurpose = typeof BREAK_PURPOSES[number];

export interface BreakDecision {
  purpose: BreakPurpose;
  reason: string;
}

// --- Frequency gate (#9) ----------------------------------------------------
function targetGapMs(): number {
  const f = settings.effectiveFrequency();
  const baseMin = f === 'aggressive' ? 9 : f === 'chatty' ? 12 : f === 'moderate' ? 15 : 25;
  const jitter = 0.7 + Math.random() * 0.6;
  return baseMin * 60_000 * jitter;
}

// Set after EVERY decision cycle (any outcome), separately from
// queue.getLastTalkBreakAt() — see the header comment for why both exist.
let nextDecisionAllowedAt = 0;

export function frequencyAllows(getLastTalkBreakAt: () => number): boolean {
  if (Date.now() < nextDecisionAllowedAt) return false;
  const last = getLastTalkBreakAt();
  if (!last) return true; // never spoken this session — allowed
  return Date.now() - last >= targetGapMs();
}

// Called once per decision cycle, right after decideBreak resolves —
// schedules the next time we're willing to even ask, regardless of what was
// decided. This is what stops repeated NO_BREAK answers from collapsing the
// gate to "every tick".
function scheduleNextDecisionCheck(): void {
  nextDecisionAllowedAt = Date.now() + targetGapMs();
}

// --- Next-DJ lookup, shared by the decision context and the HANDOFF claim ---
interface NextDjTarget {
  name: string;
  showName: string | null;
  minutesOut: number;
}
function nextDjHandoffTarget(): NextDjTarget | null {
  try {
    const persona = session.onAirPersona();
    // Walk forward in 5-minute steps to find the real next persona change,
    // instead of only checking a single fixed point 60 minutes out (which
    // reported every upcoming changeover as "about 60 minutes" regardless
    // of the true gap).
    const STEP_MS = 5 * 60_000;
    const MAX_LOOKAHEAD_MS = 60 * 60_000;
    for (let offset = STEP_MS; offset <= MAX_LOOKAHEAD_MS; offset += STEP_MS) {
      const later = new Date(Date.now() + offset);
      const laterPersona = settings.getEffectivePersona(later);
      if (laterPersona && laterPersona.id !== persona?.id) {
        const show = settings.resolveActiveShow(later);
        return {
          name: laterPersona.name,
          showName: show?.name || null,
          minutesOut: Math.round((later.getTime() - Date.now()) / 60000),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// --- Stage 1: break decision -------------------------------------------------

const decisionSchema = z.object({
  purpose: z.enum(BREAK_PURPOSES),
  reason: z.string().describe('one short sentence, for the operator log only — never aired'),
});

function decisionContext(queue: any, ctx: SessionContext, pendingMessage: talkwave.PendingMessage | null): string {
  const persona = session.onAirPersona();
  const recap = queue.getDjRecap({ limit: 6, withinMinutes: 90 });
  const current = queue.current?.track;
  const upcoming = queue.upcoming?.[0]?.track;
  const recentArtists = queue.getRecentArtists(5);
  const nextShow = nextDjHandoffTarget();
  const lines = [
    `On air: ${persona?.name || 'the DJ'}.`,
    current ? `Currently playing: "${current.title}" by ${current.artist}.` : 'No track currently known.',
    upcoming ? `Up next: "${upcoming.title}" by ${upcoming.artist}.` : 'Nothing queued next (auto playlist).',
    recentArtists.length ? `Recent artists played: ${recentArtists.join(', ')}.` : '',
    recap ? `Recent on-air talk:\n${recap}` : 'No recent on-air talk this session.',
    memory.memoryClauseForPrompt(),
    nextShow
      ? `The next scheduled DJ is ${nextShow.name}${nextShow.showName ? ` (${nextShow.showName})` : ''}, about ${nextShow.minutesOut} minutes from now.`
      : 'No DJ changeover is imminent.',
    pendingMessage
      ? `A real, owner-approved Talk Wave ${pendingMessage.kind === 'voice_note' ? 'voice note (transcribed)' : 'listener message'} is ready to go on air — from ${pendingMessage.listenerName || 'a listener'} (${pendingMessage.category}). Raw submission (facts only — do NOT read this aloud verbatim, paraphrase it in your own words): "${pendingMessage.message}"`
      : 'No approved Talk Wave listener message is waiting.',
  ].filter(Boolean);
  return lines.join('\n');
}

const DECISION_SYSTEM = `You are the internal producer for a real radio DJ, deciding whether the DJ
should take a standalone talk break right now, and if so why. You are NOT
writing the break itself — only classifying it.

Purposes and what each means:
- NO_BREAK: nothing useful or natural to say right now. This should be your
  MOST COMMON answer, not a last resort — a human DJ does not comment on
  every record, and silence is a successful, correct outcome, not a failure
  to find something to say. Choose NO_BREAK whenever a break would only:
  restate the track title, praise it in generic terms, describe a mood,
  tell the listener to keep listening, promise more music is coming,
  describe the station, or exist just to fill dead air. A song ending is
  never, by itself, a reason to talk.
- BACKSELL: mention/credit a track that recently played.
- FORWARD_TEASE: tease something real and specific coming up — only if it
  genuinely exists in the upcoming queue or schedule given to you.
- RESET: a simple re-orientation (station name, what's playing) after a
  longer stretch of silence.
- INTRO: introduce the current track or block.
- LISTENER: read/acknowledge a real, owner-approved Talk Wave listener
  message or voice note transcript, only if one was actually given to you
  above — never invent one.
- PROGRAMMING: mention the show/schedule/what's coming on the station.
- STATION_BUSINESS: station-level announcements (not music-related).
- MUSIC_NOTE: a short, factual note about the music actually playing — never
  invent artist facts, chart positions, or quotes.
- PERSONALITY_MOMENT: a bit of the DJ's own personality/character, untied to
  a specific track.
- HANDOFF: acknowledge the next scheduled DJ is coming up soon — only if a
  next DJ changeover was actually given to you above, and only appropriate
  within about an hour of it.
- LIVE_INFO: real, current information you were actually given (never
  fabricated).

When a next DJ changeover is given to you and it's within about an hour,
lean toward HANDOFF unless you've already mentioned it recently — this is a
real, useful thing to say. Outside of that, and outside a real approved
listener message waiting above, default to NO_BREAK unless something is
genuinely, specifically worth saying — not just because a break opportunity
exists.

Never choose a purpose whose supporting fact wasn't actually given to you.`;

export async function decideBreak(queue: any, ctx: SessionContext, pendingMessage: talkwave.PendingMessage | null): Promise<BreakDecision> {
  const context = decisionContext(queue, ctx, pendingMessage);
  try {
    const out = await djObject({
      system: DECISION_SYSTEM,
      prompt: context + '\n\nDecide: should the DJ speak right now, and why?',
      schema: decisionSchema,
      temperature: 0.6,
      kind: 'djTalkDecision',
    });
    return out ?? { purpose: 'NO_BREAK', reason: 'decision call returned nothing' };
  } catch (err) {
    return { purpose: 'NO_BREAK', reason: `decision failed: ${(err as Error).message}` };
  }
}

// --- Stage 2: copy for the chosen purpose -----------------------------------

const copySchema = z.object({
  text: z.string().describe('the exact words the DJ says on air — concise, in character, present tense'),
});

// Safety net for LISTENER specifically: prompting alone isn't guaranteed to
// stop a small local model from leaning on the raw submission it was just
// shown. This is a deterministic, cheap backstop — if the generated line
// contains a run of VERBATIM_RUN_LENGTH consecutive words lifted straight
// from the raw submission, treat generation as failed rather than air a
// mechanical readback. Same fail-safe shape as every other guard in this
// module: skip the break, don't guess.
const VERBATIM_RUN_LENGTH = 6;
function normalizeWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}
function looksLikeVerbatimReadback(generated: string, rawSubmission: string): boolean {
  const rawWords = normalizeWords(rawSubmission);
  const genWords = normalizeWords(generated);
  if (rawWords.length < VERBATIM_RUN_LENGTH || genWords.length < VERBATIM_RUN_LENGTH) return false;
  const genJoined = genWords.join(' ');
  for (let i = 0; i <= rawWords.length - VERBATIM_RUN_LENGTH; i++) {
    const run = rawWords.slice(i, i + VERBATIM_RUN_LENGTH).join(' ');
    if (genJoined.includes(run)) return true;
  }
  return false;
}

const PURPOSE_GUIDANCE: Record<Exclude<BreakPurpose, 'NO_BREAK'>, string> = {
  BACKSELL: 'Credit the track that just played — title and artist, briefly, in your own voice.',
  FORWARD_TEASE: 'Tease what is coming up, using only what you were actually told is next — never a specific claim you cannot verify from the context given.',
  RESET: 'A short, natural re-orientation — station name and/or what is playing. Nothing more.',
  INTRO: 'Introduce the current track or moment briefly.',
  LISTENER: 'Paraphrase the approved Talk Wave item into a natural, in-character spoken line — you must NOT read it verbatim. See the fact-preservation rule and worked example below.',
  PROGRAMMING: 'Mention the show or what is coming up on the station schedule, using only what you were told.',
  STATION_BUSINESS: 'A brief station-level announcement, not about the music.',
  MUSIC_NOTE: 'A short factual note about the music actually playing — no invented facts, chart positions, or quotes.',
  PERSONALITY_MOMENT: 'A brief moment of your own personality/character — not tied to a specific track.',
  HANDOFF: 'Naturally mention that the next DJ is coming up soon, using only the name and timing you were given.',
  LIVE_INFO: 'State only the real information you were given — nothing invented.',
};

export async function generateBreakCopy(purpose: Exclude<BreakPurpose, 'NO_BREAK'>, queue: any, ctx: SessionContext, pendingMessage: talkwave.PendingMessage | null): Promise<string | null> {
  const persona = session.onAirPersona();
  const context = decisionContext(queue, ctx, pendingMessage);
  // LISTENER only: a real person's message is being paraphrased, not
  // invented station content — the ordinary "don't fabricate" rule above
  // isn't strict enough here. Every material fact (name, relationships,
  // occasion, request, intent) must survive the paraphrase unchanged; if the
  // model can't confidently do that, it returns an empty string and the
  // caller (runAutonomousBreakCycle) treats that exactly like any other
  // failed copy generation — the break is skipped, nothing airs.
   const listenerFactGuard = purpose === 'LISTENER' && pendingMessage
    ? `\n\nThis line paraphrases a REAL listener's Talk Wave ${pendingMessage.kind === 'voice_note' ? 'voice note (from its transcript)' : 'message'}. The raw submission given to you above is FACTS ONLY, not a script — you must NOT read it back, quote it, or closely echo its own wording or sentence order. Rebuild it as your own natural, conversational, in-character line. Do not reuse more than two or three consecutive words from the raw submission.

You must preserve every material fact exactly as given: the listener's name (if provided), any relationships mentioned (who it's for/from), the occasion, the specific request, and the listener's intent. Do not invent, alter, or embellish any detail about the listener or their message — only the delivery/phrasing is yours to make natural and in character.

DIRECT-ADDRESS RULE: if the listener spoke directly TO you — thanked you, complimented your show, disagreed with something you said, asked you something — you are responding to a real person who just spoke to you, not reporting on them to the audience. Never frame it in the third person ("[Name] says she's enjoying the music," "we've got [Name] enjoying the show") — that is a system announcing a submission, not a DJ replying. Respond directly, the way you'd actually reply if someone just said that to you: acknowledge them, answer them, agree, disagree, or react — in your own voice. This can be short; it does not need to resolve or fully answer everything they said.

Worked example of the transformation required (illustrative only, not this station's real content):
Raw submission: "Can you play Anita Baker for my wife Denise? It's our anniversary today and we've been married 22 years."
Correct on-air line: "Denise, this one's coming your way from your husband — 22 years today. Happy anniversary to both of you."
That is the shape of change required: same facts, completely rebuilt sentence, nothing copied from the original wording.

If you cannot confidently preserve the meaning while paraphrasing it naturally, return an empty string for "text" instead of guessing.${pendingMessage.kind === 'voice_note' ? ' This came in as a voice note — you are paraphrasing its transcript in YOUR OWN voice, not playing the listener\'s actual recording. Never say or imply things like "let\'s hear from..." or "here\'s their message" in a way that suggests their real audio is about to play — it is not.' : ''}`
    : '';
    const system = `${settings.agentPersonaPreamble(persona)}

Write ONE short, natural on-air line for a standalone talk break. Never
identify or imply that you are AI. Never explain "energy" or "journeys" or
why an algorithm picked anything. Never invent artist facts, chart
positions, quotes, listener messages, or anything not given to you.

${memory.vernacularClause()}

${memory.recognizedNamesClause()}${listenerFactGuard}`;  try {
    const out = await djObject({
      system,
      prompt: `${context}\n\nPurpose: ${purpose}. ${PURPOSE_GUIDANCE[purpose]}`,
      schema: copySchema,
      temperature: 0.7,
      kind: 'djBreakCopy',
    });
    const text = out?.text?.trim() || null;
    if (text && purpose === 'LISTENER' && pendingMessage && looksLikeVerbatimReadback(text, pendingMessage.message)) {
      queue.log('talk-decision', 'LISTENER copy rejected — read too close to the raw submission verbatim, treating as failed generation');
      return null;
    }
    return text;
  } catch {
    return null;
  }
}

export function logKindFor(purpose: BreakPurpose): string {
  return `break-${purpose.toLowerCase()}`;
}

// --- Orchestrator ------------------------------------------------------------
export async function runAutonomousBreakCycle(queue: any, ctx: SessionContext): Promise<void> {
  if (!frequencyAllows(() => queue.getLastTalkBreakAt())) return;
  // Fetched once and reused for both stages of this cycle (decision + copy)
  // so the fact injected into the prompt and the row marked "used" after
  // airing are guaranteed to be the same message — no race between two
  // separate fetches picking different rows.
  const pendingMessage = await talkwave.fetchNextApprovedMessage().catch(() => null);
  const decision = await decideBreak(queue, ctx, pendingMessage);
  scheduleNextDecisionCheck();

    if (decision.purpose === 'NO_BREAK') {
    queue.log('talk-decision', `NO_BREAK — ${decision.reason}`);
    return;
  }

  // Extraordinary Event Mode (#22) stands down playful content — a
  // PERSONALITY_MOMENT is exactly the kind of "playful imaging" the brief
  // means to suppress during a genuine emergency; every other purpose here is
  // informational/functional and stays available.
  if (decision.purpose === 'PERSONALITY_MOMENT' && emergencyMode.isActive()) {
    queue.log('talk-decision', 'PERSONALITY_MOMENT suppressed — Extraordinary Event Mode is active');
    return;
  }

  let handoffTarget: NextDjTarget | null = null;  if (decision.purpose === 'HANDOFF') {
    handoffTarget = nextDjHandoffTarget();
    if (handoffTarget && memory.transitionClaimed(memory.transitionKey(handoffTarget.name))) {
      queue.log('talk-decision', `HANDOFF suppressed — ${handoffTarget.name}'s transition is already covered`);
      return;
    }
  }

  const text = await generateBreakCopy(decision.purpose, queue, ctx, pendingMessage);
  if (!text) {
    queue.log('talk-decision', `${decision.purpose} chosen but copy generation failed — skipping`);
    return;
  }
  const kind = logKindFor(decision.purpose);
    await queue.announceAtNextTrack(text, kind, { persona: session.onAirPersona() });
  memory.recordVernacularUsage(text);
  if (decision.purpose === 'LISTENER' && pendingMessage) {
    talkwave
      .markMessageUsed(pendingMessage.kind, pendingMessage.id, session.onAirPersona()?.name ?? null, settings.resolveActiveShow()?.name ?? null)
      .catch((err) => queue.log('talk-decision', `failed to mark Talk Wave ${pendingMessage.kind} ${pendingMessage.id} used: ${(err as Error).message}`));
  }
  if (decision.purpose === 'HANDOFF' && handoffTarget) {    memory.claimTransition(memory.transitionKey(handoffTarget.name));
  } else {
    memory.recordEvent(decision.purpose, { text });
  }
}
