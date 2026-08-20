import assert from 'node:assert/strict';
import test from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import {
  parseFunctionGemmaCall,
  parseOpenAiCalls,
  producerRouterConfig,
  producerSegmentRouterEnabled,
  routeProducerDiscovery,
  routeProducerResearch,
} from '../src/llm/internal/producer/router.js';

test('Producer Router stays disabled until both endpoint and model are configured', () => {
  assert.equal(producerRouterConfig({} as NodeJS.ProcessEnv), null);
  assert.equal(producerRouterConfig({ PRODUCER_ROUTER_BASE_URL: 'http://router/v1' } as NodeJS.ProcessEnv), null);
  assert.deepEqual(producerRouterConfig({
    PRODUCER_ROUTER_BASE_URL: 'http://router/v1',
    PRODUCER_ROUTER_MODEL: 'router.gguf',
    PRODUCER_ROUTER_TIMEOUT_MS: '250',
  } as NodeJS.ProcessEnv), {
    baseUrl: 'http://router/v1', model: 'router.gguf', timeoutMs: 1000,
  });
  assert.equal(producerSegmentRouterEnabled({} as NodeJS.ProcessEnv), false);
  assert.equal(producerSegmentRouterEnabled({ PRODUCER_ROUTER_SEGMENTS: 'true' } as NodeJS.ProcessEnv), true);
});

test('parses native OpenAI and llama.cpp FunctionGemma tool calls', () => {
  assert.deepEqual(parseOpenAiCalls([{ function: {
    name: 'tracksLikeThis', arguments: '{"songId":"seed-1"}',
  } }]), [{ name: 'tracksLikeThis', arguments: { songId: 'seed-1' } }]);
  assert.deepEqual(
    parseFunctionGemmaCall('<start_function_call>call:tracksByMood{mood:<escape>night<escape>,energy:null}<end_function_call>'),
    [{ name: 'tracksByMood', arguments: { mood: 'night', energy: null } }],
  );
  assert.deepEqual(
    parseFunctionGemmaCall('<start_function_call>call:skill_web_search_v2{query:None}<end_function_call>'),
    [{ name: 'skill_web_search_v2', arguments: { query: null } }],
  );
  assert.equal(parseFunctionGemmaCall([
    '<start_function_call>call:tracksLikeThis{songId:<escape>seed-1<escape>}',
    '<start_function_call>call:tracksByMood{mood:<escape>night<escape>,energy:null}',
  ].join('\n')).length, 2);
});

function jsonResponse(message: any, usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }) {
  return new Response(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }], usage }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('executes one routed discovery tool and records grounded candidates', async () => {
  const seen = new Map<string, any>();
  const calls: any[] = [];
  const records: any[] = [];
  const result = await routeProducerDiscovery({
    scope: {} as any,
    prompt: 'Use semantic similarity for seed-1.',
    config: { baseUrl: 'http://router/v1', model: 'router.gguf', timeoutMs: 5000 },
    fetchImpl: (async (_url: any, init: any) => {
      calls.push(JSON.parse(init.body));
      return jsonResponse({
        role: 'assistant', content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: {
          name: 'tracksLikeThis', arguments: '{"songId":"seed-1"}',
        } }],
      });
    }) as any,
    buildTools: (() => ({
      seen,
      tools: {
        tracksLikeThis: tool({
          description: 'semantic neighbours',
          inputSchema: z.object({ songId: z.string() }),
          execute: async ({ songId }) => {
            const candidate = { id: 'candidate-1', title: 'One', artist: 'Artist', seed: songId };
            seen.set(candidate.id, candidate);
            return [candidate];
          },
        }),
      },
    })) as any,
    recordImpl: ((value: any) => records.push(value)) as any,
  });

  assert.equal(result.seen.size, 1);
  assert.equal(result.steps, 1);
  assert.equal(result.toolCalls[0].name, 'tracksLikeThis');
  assert.equal(calls[0].tool_choice, 'required');
  assert.equal(records[0].kind, 'djProducerRoute');
  assert.equal(records[0].ok, true);
});

test('replays an empty tool result and permits exactly one recovery route', async () => {
  const seen = new Map<string, any>();
  const requests: any[] = [];
  let responseNumber = 0;
  const result = await routeProducerDiscovery({
    scope: {} as any,
    prompt: 'Find a useful source.',
    config: { baseUrl: 'http://router/v1', model: 'router.gguf', timeoutMs: 5000 },
    fetchImpl: (async (_url: any, init: any) => {
      requests.push(JSON.parse(init.body));
      responseNumber += 1;
      const name = responseNumber === 1 ? 'tracksLikeThis' : 'tracksByMood';
      const args = responseNumber === 1 ? { songId: 'seed-1' } : { mood: 'night', energy: null };
      return jsonResponse({
        role: 'assistant',
        content: `<start_function_call>call:${name}{${Object.entries(args).map(([key, value]) => `${key}:${value === null ? 'null' : `<escape>${value}<escape>`}`).join(',')}}<end_function_call>`,
      });
    }) as any,
    buildTools: (() => ({
      seen,
      tools: {
        tracksLikeThis: tool({
          description: 'semantic neighbours',
          inputSchema: z.object({ songId: z.string() }),
          execute: async () => ({ tracks: [], note: 'empty index' }),
        }),
        tracksByMood: tool({
          description: 'mood tags',
          inputSchema: z.object({ mood: z.string(), energy: z.enum(['low', 'medium', 'high']).nullable() }),
          execute: async () => {
            const candidate = { id: 'candidate-2', title: 'Two', artist: 'Other' };
            seen.set(candidate.id, candidate);
            return [candidate];
          },
        }),
      },
    })) as any,
    recordImpl: (() => {}) as any,
  });

  assert.equal(result.steps, 2);
  assert.deepEqual(result.toolCalls.map(call => call.name), ['tracksLikeThis', 'tracksByMood']);
  assert.deepEqual(
    requests[0].tools.map((entry: any) => entry.function.name).sort(),
    ['tracksByMood', 'tracksLikeThis'],
  );
  assert.deepEqual(
    requests[1].tools.map((entry: any) => entry.function.name),
    ['tracksByMood'],
  );
  assert.equal(requests[1].messages.at(-2).role, 'assistant');
  assert.equal(requests[1].messages.at(-1).role, 'tool');
});

test('rejects a repeated empty route because exhausted tools are no longer offered', async () => {
  const requests: any[] = [];
  await assert.rejects(routeProducerDiscovery({
    scope: {} as any,
    prompt: 'Continue a restrictive sonic journey.',
    config: { baseUrl: 'http://router/v1', model: 'router.gguf', timeoutMs: 5000 },
    fetchImpl: (async (_url: any, init: any) => {
      requests.push(JSON.parse(init.body));
      return jsonResponse({
        role: 'assistant',
        content: '<start_function_call>call:tracksTowardJourney{}<end_function_call>',
      });
    }) as any,
    buildTools: (() => ({
      seen: new Map(),
      tools: {
        tracksTowardJourney: tool({
          description: 'continue the journey', inputSchema: z.object({}), execute: async () => [],
        }),
        tracksByMood: tool({
          description: 'show mood', inputSchema: z.object({}), execute: async () => [],
        }),
      },
    })) as any,
    recordImpl: (() => {}) as any,
  }), /unavailable tool/);

  assert.deepEqual(requests[1].tools.map((entry: any) => entry.function.name), ['tracksByMood']);
});

test('rejects unoffered calls before execution and records failure', async () => {
  const records: any[] = [];
  await assert.rejects(routeProducerDiscovery({
    scope: {} as any,
    prompt: 'route',
    config: { baseUrl: 'http://router/v1', model: 'router.gguf', timeoutMs: 5000 },
    fetchImpl: (async () => jsonResponse({
      role: 'assistant', content: '<start_function_call>call:inventedTool{}<end_function_call>',
    })) as any,
    buildTools: (() => ({
      seen: new Map(),
      tools: { randomSongs: tool({ description: 'random', inputSchema: z.object({}), execute: async () => [] }) },
    })) as any,
    recordImpl: ((value: any) => records.push(value)) as any,
  }), /unavailable tool/);
  assert.equal(records[0].ok, false);
});

test('routes and executes exactly one segment research tool', async () => {
  const requests: any[] = [];
  const records: any[] = [];
  const result = await routeProducerResearch({
    prompt: 'Research the exact track now playing.',
    tools: {
      skill_now_playing_dig_v2: tool({
        description: 'exact-track specialist research',
        inputSchema: z.object({}),
        execute: async () => ({ available: true, claim: 'Produced by Example Producer.' }),
      }),
      skill_news_v2: tool({
        description: 'general headlines', inputSchema: z.object({}), execute: async () => [],
      }),
    },
    config: { baseUrl: 'http://router/v1', model: 'router-v2.gguf', timeoutMs: 5000 },
    fetchImpl: (async (_url: any, init: any) => {
      requests.push(JSON.parse(init.body));
      return jsonResponse({
        role: 'assistant',
        content: '<start_function_call>call:skill_now_playing_dig_v2{}<end_function_call>',
      });
    }) as any,
    recordImpl: ((value: any) => records.push(value)) as any,
  });

  assert.equal(requests.length, 1);
  assert.equal(result.name, 'skill_now_playing_dig_v2');
  assert.deepEqual(result.result, { available: true, claim: 'Produced by Example Producer.' });
  assert.equal(records[0].kind, 'djProducerSegmentRoute');
  assert.equal(records[0].ok, true);
});

test('preferred playlist discovery alternates to another tool on the following route', async () => {
  const requests: any[] = [];
  const buildTools = () => {
    const seen = new Map<string, any>();
    return {
      seen,
      tools: {
        showPlaylistTracks: tool({ description: 'pinned playlist', inputSchema: z.object({}), execute: async () => {
          seen.set('playlist-track', { id: 'playlist-track' });
          return [{ id: 'playlist-track' }];
        } }),
        tracksByMood: tool({ description: 'mood tags', inputSchema: z.object({}), execute: async () => {
          seen.set('library-track', { id: 'library-track' });
          return [{ id: 'library-track' }];
        } }),
      },
    };
  };
  const config = { baseUrl: 'http://router/v1', model: 'router.gguf', timeoutMs: 5000 };
  const fetchImpl = (async (_url: any, init: any) => {
    const request = JSON.parse(init.body);
    requests.push(request);
    const names = request.tools.map((entry: any) => entry.function.name);
    const name = names.includes('showPlaylistTracks') ? 'showPlaylistTracks' : 'tracksByMood';
    return jsonResponse({ role: 'assistant', content: `<start_function_call>call:${name}{}<end_function_call>` });
  }) as any;

  const first = await routeProducerDiscovery({
    scope: {} as any, prompt: 'Start inside the preferred playlist.', config, fetchImpl,
    buildTools: (() => buildTools()) as any, recordImpl: (() => {}) as any,
  });
  const second = await routeProducerDiscovery({
    scope: {} as any, prompt: 'Use another discovery axis.', config, fetchImpl,
    buildTools: (() => buildTools()) as any,
    excludeToolNames: new Set(['showPlaylistTracks']), recordImpl: (() => {}) as any,
  });

  assert.equal(first.toolCalls[0].name, 'showPlaylistTracks');
  assert.equal(second.toolCalls[0].name, 'tracksByMood');
  assert.ok(requests[0].tools.some((entry: any) => entry.function.name === 'showPlaylistTracks'));
  assert.ok(!requests[1].tools.some((entry: any) => entry.function.name === 'showPlaylistTracks'));
});
