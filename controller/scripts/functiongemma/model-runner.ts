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
    if (values?.includes(null)) {
      properties[key] = {
        type: ['string', 'null'],
        enum: [...values.filter(value => value !== null), null],
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
    tracksByMood: 'Tracks carrying one supported station mood. Call with exactly mood and energy; energy is low, medium, high, or null.',
    deepCuts: 'Tracks never aired or absent from rotation for a long time.',
    starredSongs: "The operator's starred tracks.",
    recentlyAdded: 'Tracks from recently added albums.',
    randomSongs: 'A random sample from the whole library.',
    tracksLikeThis: 'Semantic neighbours of the supplied seed track id.',
    similarSongs: 'Music-server neighbours of the supplied seed track id.',
    skill_album_anniversary: 'Check whether the album on air has a round-number anniversary this year.',
    skill_album_anniversary_v2: 'Check the original studio-album release date for a meaningful anniversary.',
    skill_curiosity: 'Fetch one fresh historical event tied to today\'s date.',
    skill_curiosity_v2: 'Fetch one fresh, verifiable historical event tied to today\'s date.',
    skill_library_deep_cut: 'Find a long-unplayed library track by the artist currently on air.',
    skill_news: 'Fetch fresh general headlines from the configured news feed.',
    skill_news_v2: 'Fetch fresh general or show-relevant music headlines.',
    skill_now_playing_dig: 'Research a verifiable detail about the exact track now playing.',
    skill_now_playing_dig_v2: 'Research specialist sources for a verifiable detail about the exact track now playing.',
    skill_weather: 'Fetch current weather and whether conditions changed since the last bulletin.',
    skill_weather_v2: 'Fetch current weather plus a short look ahead.',
    skill_web_search: 'Search for recent news about the artist now playing.',
    skill_web_search_v2: 'Search curated music sources for recent news about the artist now playing.',
    generateProgrammePlan: 'Create the current show\'s backstage episode plan before on-air writing begins.',
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

// llama.cpp currently classifies the official FunctionGemma GGUF template as
// `Content-only`, so its native call can arrive in message.content rather than
// OpenAI `tool_calls`. Keep this adapter deliberately narrow: it recognises
// exactly FunctionGemma's documented call envelope and simple flat arguments.
export function parseFunctionGemmaContent(content: unknown): PredictedToolCall[] {
  if (typeof content !== 'string') return [];
  // Parse every marked call, including a call whose closing marker is absent.
  // This makes a leaked second call visible to the scorer instead of silently
  // accepting only the final well-formed envelope.
  return [...content.matchAll(/<start_function_call>call:([^\s{]+)\{([^}]*)\}/g)].map(match => {
    const args: Record<string, unknown> = {};
    for (const part of splitArguments(match[2])) {
      const separator = part.indexOf(':');
      if (separator < 1) continue;
      const key = part.slice(0, separator).trim();
      const raw = part.slice(separator + 1).trim();
      args[key] = functionGemmaScalar(raw);
    }
    return { name: match[1], arguments: args };
  });
}

function splitArguments(raw: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let escaped = false;
  for (let index = 0; index < raw.length; index++) {
    if (raw.startsWith('<escape>', index)) {
      escaped = !escaped;
      index += '<escape>'.length - 1;
    } else if (raw[index] === ',' && !escaped) {
      parts.push(raw.slice(start, index));
      start = index + 1;
    }
  }
  if (raw.slice(start).trim()) parts.push(raw.slice(start));
  return parts;
}

function functionGemmaScalar(raw: string): unknown {
  if (raw.startsWith('<escape>') && raw.endsWith('<escape>')) {
    return raw.slice('<escape>'.length, -'<escape>'.length);
  }
  if (raw === 'null' || raw === 'None') return null;
  if (raw === 'true' || raw === 'True') return true;
  if (raw === 'false' || raw === 'False') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
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
  const responseText: string[] = [];
  const finishReasons: string[] = [];
  const callsPerRound: number[] = [];
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
          // A tool call is tiny. Without an explicit ceiling the untuned 270M
          // model can continue generating after the call until the HTTP
          // deadline, while larger instruction models tend to stop naturally.
          max_tokens: 256,
          // Stock llama.cpp may not know FunctionGemma's output parser even
          // when it correctly renders the GGUF's input template. Stop after
          // one native call so it cannot continue into invented responses.
          stop: ['<end_function_call>'],
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
    if (typeof message?.content === 'string' && message.content.trim()) {
      responseText.push(message.content.trim());
    }
    if (body?.choices?.[0]?.finish_reason != null) {
      finishReasons.push(String(body.choices[0].finish_reason));
    }
    const rawCalls: OpenAiToolCall[] = message?.tool_calls ?? [];
    const parsed = rawCalls.length
      ? parseToolCalls(rawCalls)
      : parseFunctionGemmaContent(message?.content);
    callsPerRound.push(parsed.length);
    const replayCalls: OpenAiToolCall[] = rawCalls.length ? rawCalls : parsed.map((call, index) => ({
      id: `functiongemma-${round}-${index}`,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    }));
    calls.push(...parsed);
    // One decision point permits exactly one call. Do not fabricate tool
    // results for an invalid multi-call response during evaluation.
    if (parsed.length !== 1) break;

    messages.push({
      role: 'assistant',
      // When we converted a native content envelope to tool_calls, do not
      // replay that same envelope as prose as well.
      content: rawCalls.length ? (message?.content ?? null) : null,
      tool_calls: replayCalls,
    });
    for (const [index, call] of parsed.entries()) {
      messages.push({
        role: 'tool',
        tool_call_id: replayCalls[index]?.id ?? `call-${round}-${index}`,
        name: call.name,
        content: JSON.stringify(resultFor(scenario, call)),
      });
    }
    if (parsed.some(call => call.name === 'done')) break;
  }

  return {
    scenario: scenario.id,
    calls,
    latencyMs: Date.now() - started,
    ...(responseText.length ? { responseText: responseText.join('\n\n') } : {}),
    ...(finishReasons.length ? { finishReasons } : {}),
    callsPerRound,
  };
}
