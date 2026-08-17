// Optional tiny-model discovery router for the split Producer picker.
//
// This is intentionally narrower than djAgent: the router may call one real
// library discovery tool and, only when that returns no candidates, make one
// recovery call. It never chooses the final track. The configured Producer LLM
// receives the grounded candidates afterwards and owns the editorial decision.

import { z } from 'zod';
import type { ToolSet } from 'ai';
import { buildPickerTools, type PickerScope } from '../tools/picker/index.js';
import { record } from '../telemetry/log.js';

const ROUTER_SYSTEM = [
  'You are a model that can do function calling with the following functions.',
  'You are the backstage Producer Router for a live personal radio station.',
  'Use exactly one offered function at each decision point.',
  'Never invent a track id. The current track is a discovery seed, not a valid pick.',
].join(' ');

interface RouterConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
}

export interface RoutedDiscovery {
  seen: Map<string, any>;
  steps: number;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
}

interface ParsedCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface OpenAiToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

export function producerRouterConfig(env: NodeJS.ProcessEnv = process.env): RouterConfig | null {
  const baseUrl = String(env.PRODUCER_ROUTER_BASE_URL ?? '').trim();
  const model = String(env.PRODUCER_ROUTER_MODEL ?? '').trim();
  if (!baseUrl || !model) return null;
  const requested = Number(env.PRODUCER_ROUTER_TIMEOUT_MS ?? 15_000);
  const timeoutMs = Number.isFinite(requested) ? Math.max(1_000, Math.min(60_000, requested)) : 15_000;
  const apiKey = String(env.PRODUCER_ROUTER_API_KEY ?? '').trim();
  return { baseUrl, model, timeoutMs, ...(apiKey ? { apiKey } : {}) };
}

function endpoint(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  return clean.endsWith('/v1') ? `${clean}/chat/completions` : `${clean}/v1/chat/completions`;
}

export function parseOpenAiCalls(rawCalls: readonly OpenAiToolCall[] | undefined): ParsedCall[] {
  return (rawCalls ?? []).map((call, index) => {
    const name = String(call.function?.name ?? '') || `<unnamed-${index + 1}>`;
    const raw = call.function?.arguments ?? {};
    if (typeof raw !== 'string') {
      return { name, arguments: raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {} };
    }
    try {
      const parsed = JSON.parse(raw);
      return { name, arguments: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} };
    } catch {
      return { name, arguments: { __invalidJson: raw } };
    }
  });
}

// llama.cpp may expose FunctionGemma's native call in content rather than in
// OpenAI tool_calls. Recognise only its documented, flat call envelope.
export function parseFunctionGemmaCall(content: unknown): ParsedCall[] {
  if (typeof content !== 'string') return [];
  const match = content.match(/<start_function_call>call:([^\s{]+)\{([\s\S]*?)\}(?:<end_function_call>|$)/);
  if (!match) return [];
  const args: Record<string, unknown> = {};
  for (const part of splitArguments(match[2])) {
    const separator = part.indexOf(':');
    if (separator < 1) continue;
    args[part.slice(0, separator).trim()] = scalar(part.slice(separator + 1).trim());
  }
  return [{ name: match[1], arguments: args }];
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

function scalar(raw: string): unknown {
  if (raw.startsWith('<escape>') && raw.endsWith('<escape>')) {
    return raw.slice('<escape>'.length, -'<escape>'.length);
  }
  // FunctionGemma's native envelope follows Python spellings in some
  // Transformers/llama.cpp templates even though the OpenAI schema is JSON.
  // Normalise both forms before Zod validates the real SUB/WAVE tool input.
  if (raw === 'null' || raw === 'None') return null;
  if (raw === 'true' || raw === 'True') return true;
  if (raw === 'false' || raw === 'False') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function openAiTools(tools: ToolSet): any[] {
  return Object.entries(tools).map(([name, candidate]: [string, any]) => ({
    type: 'function',
    function: {
      name,
      description: candidate.description ?? `SUB/WAVE picker function ${name}.`,
      parameters: z.toJSONSchema(candidate.inputSchema, { target: 'draft-7', io: 'input' }),
    },
  }));
}

function usageOf(body: any) {
  const input = Number(body?.usage?.prompt_tokens ?? 0) || 0;
  const output = Number(body?.usage?.completion_tokens ?? 0) || 0;
  const total = Number(body?.usage?.total_tokens ?? input + output) || input + output;
  return { input, output, total };
}

function addUsage(a: { input: number; output: number; total: number }, b: { input: number; output: number; total: number }) {
  return { input: a.input + b.input, output: a.output + b.output, total: a.total + b.total };
}

export async function routeProducerDiscovery({
  scope,
  prompt,
  config = producerRouterConfig(),
  fetchImpl = fetch,
  buildTools = buildPickerTools,
  recordImpl = record,
}: {
  scope: PickerScope;
  prompt: string;
  config?: RouterConfig | null;
  fetchImpl?: typeof fetch;
  buildTools?: typeof buildPickerTools;
  recordImpl?: typeof record;
}): Promise<RoutedDiscovery> {
  if (!config) throw new Error('Producer Router is not configured');
  const { tools, seen } = buildTools(scope);
  if (!Object.keys(tools).length) throw new Error('Producer Router has no available discovery tools');

  const started = Date.now();
  const deadline = started + config.timeoutMs;
  const messages: any[] = [
    { role: 'developer', content: ROUTER_SYSTEM },
    { role: 'user', content: prompt },
  ];
  const toolCalls: RoutedDiscovery['toolCalls'] = [];
  const exhaustedTools = new Set<string>();
  const responses: string[] = [];
  let usage = { input: 0, output: 0, total: 0 };

  try {
    for (let round = 0; round < 2; round++) {
      // Recovery must change the state of the search. Once a discovery tool
      // returns no candidates, remove it from the next request rather than
      // asking a small router to remember a prose-only "do not retry" rule.
      // This is especially important for an empty tracksTowardJourney result:
      // live testing showed both the tiny router and the larger fallback model
      // repeatedly reconstructing the same plan when the failed route remained
      // available.
      const roundToolEntries = Object.entries(tools).filter(([name]) => !exhaustedTools.has(name));
      const roundTools = Object.fromEntries(roundToolEntries) as ToolSet;
      const offered = openAiTools(roundTools);
      if (!offered.length) throw new Error('Producer Router has no untried recovery tools');
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Producer Router exhausted its shared deadline');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);
      let response: Response;
      try {
        response = await fetchImpl(endpoint(config.baseUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            tools: offered,
            tool_choice: 'required',
            parallel_tool_calls: false,
            temperature: 0,
            max_tokens: 256,
            stop: ['<end_function_call>'],
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const body: any = await response.json().catch(() => null);
      usage = addUsage(usage, usageOf(body));
      if (!response.ok) throw new Error(`Producer Router endpoint returned ${response.status}: ${JSON.stringify(body).slice(0, 240)}`);
      const message = body?.choices?.[0]?.message;
      if (typeof message?.content === 'string' && message.content.trim()) responses.push(message.content.trim());
      const rawCalls: OpenAiToolCall[] = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
      const parsed = rawCalls.length ? parseOpenAiCalls(rawCalls) : parseFunctionGemmaCall(message?.content);
      if (parsed.length !== 1) throw new Error(`Producer Router returned ${parsed.length} tool calls; expected exactly one`);
      const call = parsed[0];
      const selected: any = (roundTools as any)[call.name];
      if (!selected) throw new Error(`Producer Router selected unavailable tool "${call.name}"`);
      const validated = selected.inputSchema?.safeParse?.(call.arguments);
      if (!validated?.success) throw new Error(`Producer Router supplied invalid arguments for "${call.name}"`);
      if (typeof selected.execute !== 'function') throw new Error(`Producer Router selected non-executable tool "${call.name}"`);

      const replayId = rawCalls[0]?.id || `producer-router-${round}`;
      const before = seen.size;
      const result = await selected.execute(validated.data, {
        toolCallId: replayId,
        messages: [],
        abortSignal: undefined,
      });
      toolCalls.push({ name: call.name, args: validated.data, result });
      if (seen.size > before) break;
      exhaustedTools.add(call.name);

      messages.push({
        role: 'assistant',
        content: rawCalls.length ? (message?.content ?? null) : null,
        tool_calls: rawCalls.length ? rawCalls : [{
          id: replayId,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(validated.data) },
        }],
      });
      messages.push({
        role: 'tool',
        tool_call_id: replayId,
        name: call.name,
        content: JSON.stringify(result),
      });
    }

    if (!seen.size) throw new Error('Producer Router discovery and recovery returned no candidates');
    recordImpl({
      kind: 'djProducerRoute', ok: true, ms: Date.now() - started,
      model: config.model, via: 'openai-compatible:functiongemma', usage,
      t: new Date().toISOString(), system: ROUTER_SYSTEM, user: prompt,
      response: responses.join('\n\n'), steps: toolCalls.length, toolCalls,
    });
    return { seen, steps: toolCalls.length, toolCalls };
  } catch (error: any) {
    recordImpl({
      kind: 'djProducerRoute', ok: false, ms: Date.now() - started,
      model: config.model, via: 'openai-compatible:functiongemma', usage,
      t: new Date().toISOString(), system: ROUTER_SYSTEM, user: prompt,
      response: responses.join('\n\n'), steps: toolCalls.length, toolCalls,
      error: error?.message ?? String(error),
    });
    throw error;
  }
}
