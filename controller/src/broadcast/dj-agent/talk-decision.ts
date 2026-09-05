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
import { deriveReaction, reactionClauseForWording, type ReactionResult } from './reaction.js';
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
  reaction: ReactionResult;
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

function decisionContext(queue: any, ctx: SessionContext, pendingMessage: talkwave.PendingMessage | null, personaOverride: unknown = null): string {
  const persona: any = personaOverride ?? session.onAirPersona();
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
    (() => {
      const recognized = pendingMessage ? memory.matchRecognizedPerson(pendingMessage.listenerName) : null;
      return recognized
        ? `RECOGNITION NOTE: the Talk Wave submitter's name above matches ${recognized.name} on your RECOGNIZED NAMES list — ${recognized.recognitionNote} Treat this submission as coming from someone you recognize, not an unknown stranger's form-field name — but stay strictly within the recognition rules already given: no invented biography, relationship, memory, or disclosure beyond what's listed there. This must change how you respond, not just whether the name appears: never say "Listener ${recognized.name} says..." or "we've got ${recognized.name} enjoying the show" — that's mechanical, not recognition. A natural opener like "${recognized.name}..." or "Okay, ${recognized.name}..." shows familiarity; write your own, don't reuse these verbatim.`
        : '';
    })(),
    pendingMessage?.recentExchange
      ? `CONTINUATION NOTE: this same listener wrote in again recently. Their earlier message was: "${pendingMessage.recentExchange.priorMessage}" — and you responded on air with: "${pendingMessage.recentExchange.djResponse}". This is FACTS ONLY — if it's natural, you may acknowledge the continuation, but never invent anything beyond these two exact quoted facts.`
      : '',
    pendingMessage?.recurringCount && pendingMessage.recurringCount > 1
      ? `FAMILIARITY NOTE: this listener has written in ${pendingMessage.recurringCount} times recently — a regular, not a stranger. This may warrant slightly more warmth/familiarity if natural for your personality, but invent nothing about who they are beyond that count.`
      : '',
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

// A real listener's approved message left waiting on the model's own
// discretion, cycle after cycle, could in principle wait indefinitely — the
// station has observed genuine replies land ~2 hours after submission. Not
// an interruption (it still only fires on the normal frequency-gated
// decision cycle, per targetGapMs above), but a bound: once a message has
// waited this long, the NEXT decision cycle forces LISTENER rather than
// leaving it to the model's judgment again. "Owner sent a real message and
// it eventually got a reply" should not depend on the model happening to
// pick it.
const LISTENER_MAX_WAIT_MS = 20 * 60_000;

export async function decideBreak(queue: any, ctx: SessionContext, pendingMessage: talkwave.PendingMessage | null): Promise<BreakDecision> {
  const context = decisionContext(queue, ctx, pendingMessage);
  const persona = session.onAirPersona();
  const reaction = await deriveReaction(persona, context);

  if (pendingMessage && Date.now() - pendingMessage.waitingSince.getTime() >= LISTENER_MAX_WAIT_MS) {
    return { purpose: 'LISTENER', reason: `forced — real listener message has waited over ${Math.round(LISTENER_MAX_WAIT_MS / 60_000)} minutes`, reaction };
  }
  // Reaction informs, but never overrides, the existing purpose taxonomy or
  // its safety-relevant branches (HANDOFF claim, frequency gate, fabrication
  // guards) — none of that changes here. NOTHING_TO_ADD is a strong (not
  // absolute) steer toward NO_BREAK: silence is a legitimate, common,
  // positive outcome, not a fallback.
  const reactionNote = reaction.state === 'NOTHING_TO_ADD'
    ? `\n\nYour internal reaction to this moment is NOTHING_TO_ADD (${reaction.reason}) — this is a strong signal toward NO_BREAK unless something else genuinely independent is worth a break.`
    : `\n\nYour internal reaction to this moment is ${reaction.state} (${reaction.reason}). This may support certain purposes (e.g. a real reaction can justify PERSONALITY_MOMENT or MUSIC_NOTE) — but never invent a purpose it doesn't actually support.`;
  try {
    const out = await djObject({
      system: DECISION_SYSTEM,
      prompt: context + reactionNote + '\n\nDecide: should the DJ speak right now, and why?',
      schema: decisionSchema,
      temperature: 0.6,
      kind: 'djTalkDecision',
    });
    return { ...(out ?? { purpose: 'NO_BREAK', reason: 'decision call returned nothing' }), reaction };
  } catch (err) {
    return { purpose: 'NO_BREAK', reason: `decision failed: ${(err as Error).message}`, reaction };
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
// minRun caller-overridable: the LISTENER-message check (6-word default) and
// the style-example check (below) share this function, but a style example
// is often SHORTER than 6 words — "That's HLYST. Solid record." is 4. With a
// fixed 6-word floor, rawWords.length < VERBATIM_RUN_LENGTH short-circuited
// to false for every short example, so an exact, full-word, verbatim copy of
// a short example was NEVER detected (observed live: Marcus Reed and Miss
// Renee Cole both aired an exact copy of one of their own examples). Scaling
// the required run down to min(VERBATIM_RUN_LENGTH, rawWords.length) means a
// short example must match IN FULL to trigger — no shorter runs falsely
// flagged — while a long example still only needs any 6-word run, same as
// before.
function looksLikeVerbatimReadback(generated: string, rawSubmission: string, minRun: number = VERBATIM_RUN_LENGTH): boolean {
  const rawWords = normalizeWords(rawSubmission);
  const genWords = normalizeWords(generated);
  // Below this, a "match" is meaningless — a 1-2 word example like "HLYST."
  // will coincidentally appear in almost any legitimate line (the station
  // name is expected to come up naturally) and scaling minRun down to 1-2
  // would falsely flag that as copying. Too short to be evidence either way.
  const MIN_MEANINGFUL_WORDS = 3;
  if (rawWords.length < MIN_MEANINGFUL_WORDS) return false;
  const run = Math.min(minRun, rawWords.length);
  if (genWords.length < run) return false;
  const genJoined = genWords.join(' ');
  for (let i = 0; i <= rawWords.length - run; i++) {
    const chunk = rawWords.slice(i, i + run).join(' ');
    if (genJoined.includes(chunk)) return true;
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

export async function generateBreakCopy(purpose: Exclude<BreakPurpose, 'NO_BREAK'>, queue: any, ctx: SessionContext, pendingMessage: talkwave.PendingMessage | null, personaOverride: unknown = null, reaction?: ReactionResult): Promise<string | null> {
  const persona = personaOverride ?? session.onAirPersona();
  const context = decisionContext(queue, ctx, pendingMessage, personaOverride);
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

Worked example of the transformation required (illustrative only — a made-up training example, NOT this station's real content, NOT a real listener, NOT a real relationship, NOT a real occasion. It exists ONLY to show the SHAPE of the rewrite. If you use ANY specific detail from it — "Denise", "wife", "husband", "married", "22 years", "anniversary" — in your actual answer, that is a fabrication and a serious error, even if it sounds natural. Those details belong to this fictional example only and must never appear in your real output unless the REAL raw submission above genuinely contains them):
Raw submission: "Can you play Anita Baker for my wife Denise? It's our anniversary today and we've been married 22 years."
Correct on-air line: "Denise, this one's coming your way from your husband — 22 years today. Happy anniversary to both of you."
That is the shape of change required: same facts, completely rebuilt sentence, nothing copied from the original wording. Your REAL raw submission above almost certainly has completely different facts — a different name, a different relationship (or none at all), a different occasion (or none at all). Use ONLY what that real submission actually says.

If you cannot confidently preserve the meaning while paraphrasing it naturally, return an empty string for "text" instead of guessing.${pendingMessage.kind === 'voice_note' ? ' This came in as a voice note — you are paraphrasing its transcript in YOUR OWN voice, not playing the listener\'s actual recording. Never say or imply things like "let\'s hear from..." or "here\'s their message" in a way that suggests their real audio is about to play — it is not.' : ''}`
    : '';
    const system = `${settings.agentPersonaPreamble(persona)}

Write ONE short, natural on-air line for a standalone talk break. Never
identify or imply that you are AI. Never explain "energy" or "journeys" or
why an algorithm picked anything. Never invent artist facts, chart
positions, quotes, listener messages, or anything not given to you.

${memory.vernacularClause()}

${memory.recognizedNamesClause()}${listenerFactGuard}${reaction ? '\n\n' + reactionClauseForWording(reaction) : ''}`;  try {
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
    // Deterministic guard against the specific, observed failure of the
    // LISTENER worked example above: the model treated the illustrative
    // "Denise / wife / husband / 22 years / anniversary" example as real
    // content and fabricated a spouse and anniversary for a real listener
    // who never mentioned either — a real fabrication attributed to a real
    // person, not just an atmospheric-prose problem. If any of the example's
    // specific tokens appear in the output but do NOT appear anywhere in the
    // real raw submission, the model borrowed the example — reject rather
    // than air fabricated personal facts.
    if (text && purpose === 'LISTENER' && pendingMessage) {
      const EXAMPLE_TOKENS = ['denise', 'wife', 'husband', 'married', '22 years', 'anniversary'];
      const lowerText = text.toLowerCase();
      const lowerRaw = pendingMessage.message.toLowerCase();
      for (const token of EXAMPLE_TOKENS) {
        if (lowerText.includes(token) && !lowerRaw.includes(token)) {
          queue.log('talk-decision', `LISTENER copy rejected — used the worked example's "${token}" which is not in the real submission, treating as fabrication`);
          return null;
        }
      }
    }
    // The few-shot style examples on the persona (settings.agentPersonaPreamble)
    // are explicitly framed as style demonstrations, never a script — but a
    // small/local model can still lean on one as an answer key rather than a
    // style guide (observed: near-verbatim reuse of a style example under
    // real load). Same guard as the LISTENER check above, run against every
    // one of this persona's own examples for every purpose — reject and treat
    // as a failed generation rather than air a line that is substantially a
    // copy of an example instead of an actual reaction to what's really
    // happening right now.
    if (text) {
      const examples = (persona as { styleExamples?: unknown } | null | undefined)?.styleExamples;
      if (Array.isArray(examples)) {
        for (const ex of examples) {
          if (typeof ex === 'string' && looksLikeVerbatimReadback(text, ex)) {
            queue.log('talk-decision', `${purpose} copy rejected — too close to one of ${persona?.name ?? 'the persona'}'s own style examples verbatim, treating as failed generation`);
            return null;
          }
        }
      }
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

  const text = await generateBreakCopy(decision.purpose, queue, ctx, pendingMessage, null, decision.reaction);
  if (!text) {
    queue.log('talk-decision', `${decision.purpose} chosen but copy generation failed — skipping`);
    return;
  }
  const kind = logKindFor(decision.purpose);
    await queue.announceAtNextTrack(text, kind, { persona: session.onAirPersona() });
  memory.recordVernacularUsage(text);
  if (decision.purpose === 'LISTENER' && pendingMessage) {
    talkwave
      .markMessageUsed(pendingMessage.kind, pendingMessage.id, session.onAirPersona()?.name ?? null, settings.resolveActiveShow()?.name ?? null, text)
      .catch((err) => queue.log('talk-decision', `failed to mark Talk Wave ${pendingMessage.kind} ${pendingMessage.id} used: ${(err as Error).message}`));
  }
  if (decision.purpose === 'HANDOFF' && handoffTarget) {    memory.claimTransition(memory.transitionKey(handoffTarget.name));
  } else {
    memory.recordEvent(decision.purpose, { text });
  }
}
