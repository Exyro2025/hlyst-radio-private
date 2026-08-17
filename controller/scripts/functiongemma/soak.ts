import { isDeepStrictEqual } from 'node:util';
import { generateTrainingExamples } from './training-data.js';
import { parseFunctionGemmaContent, parseToolCalls } from './model-runner.js';
import type { PredictedToolCall } from './contracts.js';

export interface FunctionGemmaSoakCase {
  id: string;
  messages: any[];
  tools: any[];
  expected: PredictedToolCall;
}

export interface FunctionGemmaSoakResult {
  id: string;
  passed: boolean;
  latencyMs: number;
  expected: PredictedToolCall;
  actual: PredictedToolCall[];
  responseText?: string;
}

function openAiMessages(messages: readonly any[]): any[] {
  const output: any[] = [];
  let lastCallId = '';
  for (const [index, message] of messages.entries()) {
    if (message.role === 'assistant') {
      const calls = (message.tool_calls ?? []).map((call: any, callIndex: number) => {
        lastCallId = `soak-${index}-${callIndex}`;
        return {
          id: lastCallId,
          type: 'function',
          function: {
            name: call.function.name,
            arguments: JSON.stringify(call.function.arguments ?? {}),
          },
        };
      });
      output.push({ role: 'assistant', content: null, tool_calls: calls });
    } else if (message.role === 'tool') {
      const content = message.content ?? {};
      output.push({
        role: 'tool',
        tool_call_id: lastCallId,
        name: content.name,
        content: JSON.stringify(content.response ?? content),
      });
    } else {
      output.push({ role: message.role, content: message.content });
    }
  }
  return output;
}

export function buildNovelSoakCases(count = 300, seed = 0xA11CE5): FunctionGemmaSoakCase[] {
  const examples = generateTrainingExamples('development', count, seed);
  return examples.flatMap(example => {
    const cases: FunctionGemmaSoakCase[] = [];
    for (const [index, message] of example.messages.entries()) {
      if (message.role !== 'assistant') continue;
      const target = message.tool_calls?.[0];
      if (!target) continue;
      cases.push({
        id: `${example.id}.decision-${cases.length + 1}`,
        messages: openAiMessages(example.messages.slice(0, index)),
        tools: example.tools,
        expected: {
          name: target.function.name,
          arguments: target.function.arguments,
        },
      });
    }
    return cases;
  });
}

function endpoint(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  return clean.endsWith('/v1') ? `${clean}/chat/completions` : `${clean}/v1/chat/completions`;
}

export async function runSoakCase({
  candidate,
  baseUrl,
  model,
  timeoutMs = 15_000,
  fetchImpl = fetch,
}: {
  candidate: FunctionGemmaSoakCase;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<FunctionGemmaSoakResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(endpoint(baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: candidate.messages,
        tools: candidate.tools,
        tool_choice: 'required',
        parallel_tool_calls: false,
        temperature: 0,
        max_tokens: 256,
        stop: ['<end_function_call>'],
      }),
      signal: controller.signal,
    });
    const body: any = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`endpoint returned ${response.status}: ${JSON.stringify(body).slice(0, 240)}`);
    const message = body?.choices?.[0]?.message;
    const rawCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    const actual = rawCalls.length
      ? parseToolCalls(rawCalls)
      : parseFunctionGemmaContent(message?.content);
    return {
      id: candidate.id,
      passed: actual.length === 1 && isDeepStrictEqual(actual[0], candidate.expected),
      latencyMs: Date.now() - started,
      expected: candidate.expected,
      actual,
      ...(typeof message?.content === 'string' && message.content.trim()
        ? { responseText: message.content.trim() }
        : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}
