// The two tool-loop agent definitions: the track picker and the listener-request
// matcher. Both run the same harness, so they accept native output on the same
// terms.
//
// Part of the dj-agent/ split - see ../dj-agent.ts for the pick/request runs.

import * as settings from '../../settings.js';
import { defineAgent } from '../../llm/agent.js';
import { buildPickerTools, type PickerScope } from '../../llm/tools.js';
import {
  PICKER_CRITERIA,
  effectsGuidance,
  producerPromptDiscoverySteps,
  showMusicLean,
} from '../../llm/dj.js';
import { ProducerPickSchema, producerPickSystem, producerSelectSystem } from '../../llm/producer.js';
import { pickSchema, pickSystem, requestSchema, requestSystem } from './schemas.js';
import { agentDeadline } from './breaker.js';

// What pickViaAgent hands the picker each run. `scope` is the whole constraint
// set as ONE value — recency, the strict show locks, the playlist anchor, the
// journey waypoint — resolved in pickViaAgent (async work: genre free text →
// library tags, coverage gating) and passed straight through to the discovery
// tools untouched.
//
// It travels whole for a reason. The previous shape listed every constraint as
// its own key here, again in the buildTools destructure, and again in the
// buildPickerTools call: a lock named in one list and forgotten in another was
// not a type error, it just fell through to a `null` default and stopped being
// enforced on the agent path while the pool picker still honoured it — the two
// pick paths silently disagreeing about the same show. Do not unpack the scope
// into keys here; see the note at the top of llm/internal/tools/picker/scope.ts.
export interface PickerRunArgs {
  scope: PickerScope;
  // Forecast air time for the pick's link, used by the prompt only — not a
  // discovery constraint, so it stays outside the scope.
  showAt?: Date | null;
}

export interface RequestRunArgs {
  scope: PickerScope;
}

// What buildTools hands back for the caller to resolve the chosen id against.
export interface PickerExtras {
  seen: Map<string, any>;
}

// Stage C Producer input. This is deliberately rebuilt from operational state
// for each pick rather than copied from session.windowMessages(), because that
// shared window contains the Persona's listener-facing prose. Keep the track
// shapes small: selection needs identity and sequence, not generated speech or
// the full analysis record.
export function producerPickMessage({
  current = null,
  recentTracks = [],
  recentArtists = [],
  recentTransitions = [],
  selectionContext = null,
  instructions = [],
}: {
  current?: any;
  recentTracks?: any[];
  recentArtists?: string[];
  recentTransitions?: string[];
  selectionContext?: any;
  instructions?: string[];
} = {}): string {
  const track = (value: any) => value ? {
    id: value.id ?? null,
    title: value.title ?? null,
    artist: value.artist ?? null,
  } : null;
  const payload = {
    task: 'pick_next_track',
    currentTrack: track(current),
    recentTracks: recentTracks.slice(0, 6).map(track),
    recentArtists: recentArtists.slice(0, 6),
    recentTransitions: recentTransitions.slice(-6),
    selectionContext: selectionContext ? {
      period: selectionContext.time?.period ?? null,
      vibe: selectionContext.time?.vibe ?? null,
      dominantMood: selectionContext.dominantMood ?? null,
      weather: selectionContext.weather?.condition ?? null,
      festival: selectionContext.festival?.name ?? null,
    } : null,
  };
  const coaching = instructions.map((line) => String(line || '').trim()).filter(Boolean);
  return `Operational pick request:\n${JSON.stringify(payload, null, 2)}`
    + (coaching.length ? `\n\nOperational guidance:\n${coaching.map((line) => `- ${line}`).join('\n')}` : '');
}

// The live Producer sees the same editorial/show constraints and transition
// vocabulary as the established picker, but none of the Persona preamble,
// speech style, listener-facing schema text or request-to-perform wording.
// That separation is the point of the split: this prompt chooses; the later
// generatePersonaLink call independently performs the on-air task.
export function producerPickerSystem(showAt: Date | null = null, playlistResolved = true): string {
  const activeShow = settings.resolveActiveShow(showAt ?? undefined);
  const showLine = activeShow?.topic
    ? `\n\nCurrent show brief: ${activeShow.topic}`
    : '';
  const playlistLine = activeShow?.playlistIds?.length && playlistResolved
    ? `\n\nThe current show has a ${activeShow.playlistStrict ? 'strict' : 'preferred'} pinned playlist. Use the playlist-aware discovery tool and ${activeShow.playlistStrict ? 'stay inside it' : 'treat it as the strong first source'}.`
    : '';
  return `${producerPickSystem(producerPromptDiscoverySteps())}${showLine}${showMusicLean(activeShow, { includeTalk: false })}${playlistLine}

${PICKER_CRITERIA}${effectsGuidance()}`;
}

// Tool-less second half of the experimental split Producer picker. Discovery
// has already produced a grounded candidate set, so this prompt deliberately
// omits every instruction to call a library tool. The configured Producer LLM
// retains the editorial work: show fit, musical flow and transition choice.
export function producerSelectorSystem(showAt: Date | null = null, playlistResolved = true): string {
  const activeShow = settings.resolveActiveShow(showAt ?? undefined);
  const showLine = activeShow?.topic
    ? `\n\nCurrent show brief: ${activeShow.topic}`
    : '';
  const playlistLine = activeShow?.playlistIds?.length && playlistResolved
    ? `\n\nThe candidates were discovered under the current show's ${activeShow.playlistStrict ? 'strict' : 'preferred'} pinned-playlist policy.`
    : '';
  return `${producerSelectSystem()}${showLine}${showMusicLean(activeShow, { includeTalk: false })}${playlistLine}

${PICKER_CRITERIA}${effectsGuidance()}`;
}

// Compact operational request for the tiny Producer Router. It gets only the
// facts needed to choose a discovery mechanism; it does not see Persona prose,
// transition coaching, listener-facing history or the later candidate list.
export function producerRouterMessage({
  current = null,
  activeShow = null,
  playlistAvailable = false,
  playlistCoolingDown = false,
  journeyActive = false,
  explore = false,
}: {
  current?: any;
  activeShow?: any;
  playlistAvailable?: boolean;
  playlistCoolingDown?: boolean;
  journeyActive?: boolean;
  explore?: boolean;
} = {}): string {
  const direction = playlistCoolingDown
    ? 'The current track already came from the show\'s preferred pinned playlist. Deliberately use a different library discovery axis for this pick so the playlist remains an anchor, not the only source.'
    : playlistAvailable
    ? 'This programme has an operator-pinned playlist. Begin discovery inside that curated source.'
    : journeyActive
      ? 'The active sonic journey has a current waypoint. Discover music toward that waypoint.'
      : explore
        ? 'Explore neglected catalogue tracks that have never aired or have been absent for a long time.'
        : current?.id
          ? `Use the library semantic index to find music like the current track [id: ${current.id}]. If that source is unavailable, choose the closest offered similarity source.`
          : 'No usable current-track seed is available. Return a broad library sample.';
  return `${direction}\n\n${JSON.stringify({
    currentTrack: current ? {
      id: current.id ?? null,
      title: current.title ?? null,
      artist: current.artist ?? null,
    } : null,
    show: activeShow ? {
      name: activeShow.name ?? null,
      topic: activeShow.topic ?? null,
      genres: activeShow.genres ?? [],
      moods: activeShow.moods ?? [],
      energies: activeShow.energies ?? [],
      eras: activeShow.eras ?? [],
      filtersStrict: activeShow.filtersStrict === true,
      playlistStrict: activeShow.playlistStrict === true,
    } : null,
  }, null, 2)}`;
}

export const pickerAgent = defineAgent<PickerRunArgs, PickerExtras>({
  kind: 'djAgentPick',
  // Resolved per run: the effects coaching in the transition field follows
  // the on-air persona's djMode, and the say length its scriptLength — same
  // reason effectsGuidance() is dynamic. See pickSchema above.
  schema: () => pickSchema(),
  // Advisory floor only. On the done-tool path the cap is DERIVED per provider
  // (gatedMaxStepsFor = discovery budget + 1 in provider/capabilities.ts), so
  // this value reaches the model only as the `Math.max` floor on the native leg.
  //
  // The reason the derivation exists rather than a number here: GLM (Zhipu/Z.ai)
  // can decline the forced `done` call repeatedly within the SAME conversation
  // rather than complying on the first attempt, so a taller cap stopped being a
  // rarely-hit backstop and became a real (and wasted) retry budget — each extra
  // step just grows an increasingly "I already declined" trail, which made
  // compliance WORSE, not better, in testing. Deriving the cap keeps the main run
  // at exactly discovery + ONE committed attempt at every budget, and hands off
  // to agent.ts's recovery cascade sooner — recovery is the mechanism that
  // actually rescues these, not more steps on a polluted trail.
  maxSteps: 2,
  // The pick/request pair is what the per-provider discovery budget was
  // designed and tested for, so they opt in here. djAgent callers that DON'T
  // opt in (the segment director) keep the historical single discovery step —
  // a pinned step cap can be load-bearing (see directorAgent.maxSteps in
  // skills/_agent.ts), so the widening never applies implicitly.
  providerDiscoveryBudget: true,
  timeoutMs: agentDeadline,
  buildSystem: ({ showAt, scope }) => pickSystem(showAt ?? null, !!scope?.playlistTracks?.length),
  // For a strict show (filtersStrict) EVERY set music filter — genre, era, mood,
  // energy, vocals — becomes a hard lock the discovery tools enforce on
  // candidates, not just the prompt. Resolving them in one place off one show
  // snapshot keeps the prompt's brief and the tools' locks agreeing across a
  // show boundary. Track length is an on-air cut, NOT a pick filter (#447), so
  // no length cap is in the scope.
  buildTools: ({ scope }) => {
    const { tools, seen } = buildPickerTools(scope);
    return { tools, extras: { seen } };
  },
  // Native-path acceptance: the picked id must be one a discovery tool actually
  // surfaced this run. A fabricated id falls the run through to the done-tool
  // harness instead of surfacing as an unknown-id rejection (observed:
  // gpt-5-mini invented 7/32 ids after an empty tool result).
  validateObject: (object, extras) => !!(object?.id && extras?.seen?.has(object.id)),
});

export const producerPickerAgent = defineAgent<PickerRunArgs, PickerExtras>({
  kind: 'djProducerPick',
  schema: ProducerPickSchema,
  maxSteps: 2,
  providerDiscoveryBudget: true,
  timeoutMs: agentDeadline,
  temperature: 0.4,
  role: 'producer',
  buildSystem: ({ showAt, scope }) => producerPickerSystem(
    showAt ?? null,
    !!scope?.playlistTracks?.length,
  ),
  buildTools: ({ scope }) => {
    const { tools, seen } = buildPickerTools(scope);
    return { tools, extras: { seen } };
  },
  validateObject: (object, extras) => !!(object?.id && extras?.seen?.has(object.id)),
});

export const requestAgent = defineAgent<RequestRunArgs, PickerExtras>({
  kind: 'djAgentRequest',
  // Function form — resolved per run so the intro length follows the on-air
  // persona's scriptLength (see requestSchema).
  schema: () => requestSchema(),
  // See pickerAgent.maxSteps above — same reasoning.
  maxSteps: 2,
  // See pickerAgent.providerDiscoveryBudget above.
  providerDiscoveryBudget: true,
  timeoutMs: agentDeadline,
  buildSystem: () => requestSystem(),
  // resolveReferences adds the web-backed reference resolver (request path only;
  // no-op without a search provider) when the operator opts in via
  // settings.llm.requestWebResolve. Applied here rather than at the call site
  // because it is a property of THIS agent, not of the request being served.
  // (Artists are no longer filtered on any pick path — see the buildPickerTools
  // note — so a request for a recently-played artist resolves naturally.)
  buildTools: ({ scope }) => {
    const { tools, seen } = buildPickerTools({
      ...scope,
      resolveReferences: settings.get().llm?.requestWebResolve ?? false,
    });
    return { tools, extras: { seen } };
  },
  // Same native-path acceptance as pickerAgent — the request agent runs the
  // same model through the same harness, so it fabricates the same way.
  validateObject: (object, extras) => !!(object?.id && extras?.seen?.has(object.id)),
});


