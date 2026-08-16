import type {
  FunctionGemmaPrediction,
  FunctionGemmaScenario,
  PredictedToolCall,
  ToolContract,
} from './contracts.js';

const PRODUCER_SYSTEM = [
  'You are a model that can do function calling with the following functions.',
  'You are the backstage Producer for a live personal radio station.',
  'Use the offered functions to make operational music-selection decisions.',
  'Never invent a track id. The current track is a discovery seed, not a valid pick.',
  'When a done function is offered, use it only after discovery has surfaced a candidate.',
].join(' ');

export interface ModelRunnerOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}

interface OpenAiToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

export function openAiTool(contract: ToolContract) {
  const properties: Record<string, any> = {};
  const keys = new Set([
    ...(contract.required ?? []),
    ...Object.keys(contract.enums ?? {}),
  ]);
  for (const key of keys) {
    const values = contract.enums?.[key];
    if (values?.includes('null')) {
      properties[key] = {
        type: ['string', 'null'],
        enum: [...values.filter(value => value !== 'null'), null],
      };
    } else if (values) {
      properties[key] = { type: 'string', enum: [...values] };
    } else {
      properties[key] = { type: 'string' };
    }
  }
  return {
    type: 'function',
    function: {
      name: contract.name,
      description: toolDescription(contract.name),
      parameters: {
        type: 'object',
        properties,
        required: [...(contract.required ?? [])],
        additionalProperties: false,
      },
    },
  };
}

function toolDescription(name: string): string {
  const descriptions: Record<string, string> = {
    showPlaylistTracks: "Tracks from the show's operator-pinned playlists. Use this first when one is active.",
    tracksTowardJourney: "Tracks nearest the active sonic journey's current waypoint.",
    songsByGenre: 'Tracks carrying a named library genre tag.',
    searchLibrary: 'Search for a named artist, title, genre or vibe.',
    tracksByEnergy: 'Tracks at one structured energy level: low, medium or high.',
    tracksByMood: 'Tracks carrying one supported station mood, optionally narrowed by energy.',
    deepCuts: 'Tracks never aired or absent from rotation for a long time.',
    starredSongs: "The operator's starred tracks.",
    recentlyAdded: 'Tracks from recently added albums.',
    randomSongs: 'A random sample from the whole library.',
    tracksLikeThis: 'Semantic neighbours of the supplied seed track id.',
    similarSongs: 'Music-server neighbours of the supplied seed track id.',
    done: 'Commit the final grounded track id, private reason and transition.',
  };
  return descriptions[name] ?? `SUB/WAVE picker function ${name}.`;
}

export function parseToolCalls(rawCalls: readonly OpenAiToolCall[] | undefined): PredictedToolCall[] {
  return (rawCalls ?? []).map((call, index) => {
    const name = String(call.function?.name ?? '');
    const rawArguments = call.function?.arguments ?? {};
    let args: Record<string, unknown> = {};
    if (typeof rawArguments === 'string') {
      try {
        const parsed = JSON.parse(rawArguments);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
      } catch {
        args = { __invalidJson: rawArguments };
      }
    } else if (rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
      args = rawArguments;
    }
    return { name: name || `<unnamed-${index + 1}>`, arguments: args };
  });
}

function endpoint(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  return clean.endsWith('/v1') ? `${clean}/chat/completions` : `${clean}/v1/chat/completions`;
}

function resultFor(scenario: FunctionGemmaScenario, call: PredictedToolCall): unknown {
  if (call.name === 'done') return { accepted: true };
  return scenario.mockResults?.[call.name] ?? { tracks: [] };
}

export async function runModelScenario(
  scenario: FunctionGemmaScenario,
  options: ModelRunnerOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<FunctionGemmaPrediction> {
  const messages: any[] = [
    // FunctionGemma's model card requires the function-calling instruction in
    // the developer role. Do not silently normalise this to `system`: the model
    // uses a different chat format from ordinary Gemma 3.
    { role: 'developer', content: PRODUCER_SYSTEM },
    { role: 'user', content: scenario.prompt },
  ];
  const calls: PredictedToolCall[] = [];
  const started = Date.now();
  const maxRounds = scenario.stage === 'recover' ? 3 : 1;

  for (let round = 0; round < maxRounds; round++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
    let response: Response;
    try {
      response = await fetchImpl(endpoint(options.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          tools: scenario.tools.map(openAiTool),
          tool_choice: 'required',
          parallel_tool_calls: false,
          temperature: 0,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const body: any = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`model endpoint returned ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
    }
    const message = body?.choices?.[0]?.message;
    const rawCalls: OpenAiToolCall[] = message?.tool_calls ?? [];
    const parsed = parseToolCalls(rawCalls);
    calls.push(...parsed);
    if (!parsed.length) break;

    messages.push({
      role: 'assistant',
      content: message?.content ?? null,
      tool_calls: rawCalls,
    });
    for (const [index, call] of parsed.entries()) {
      messages.push({
        role: 'tool',
        tool_call_id: rawCalls[index]?.id ?? `call-${round}-${index}`,
        content: JSON.stringify(resultFor(scenario, call)),
      });
    }
    if (parsed.some(call => call.name === 'done')) break;
  }

  return { scenario: scenario.id, calls, latencyMs: Date.now() - started };
}
