// Split-architecture Producer evaluation. These scenarios deliberately use
// synthetic data and never call queue/session/TTS code: they test whether a
// candidate Producer can make grounded backstage decisions before it is ever
// allowed near the live station.

import { tool } from 'ai';
import { z } from 'zod';
import type { KindSpec } from './types.js';
import { djAgent } from '../../../src/llm/sdk.js';
import {
  ProducerPickSchema,
  ProducerSegmentSchema,
  checkProducerPick,
  checkProducerSegment,
  producerPickSystem,
  producerSegmentSystem,
} from '../../../src/llm/producer.js';
import { tagBatch } from '../../../src/music/tagger-core.js';
import { pickerAgent } from '../../../src/broadcast/dj-agent.js';
import { promptDiscoverySteps } from '../../../src/llm/dj.js';
import { pickerToolsSynthetic } from '../fixtures.js';

function producerPickScenario(name: string, content: string) {
  return {
    name,
    run: async () => {
      const { tools, seen } = pickerToolsSynthetic();
      const result = await djAgent({
        system: producerPickSystem(promptDiscoverySteps()),
        messages: [{ role: 'user', content }],
        tools,
        schema: ProducerPickSchema,
        maxSteps: 2,
        providerDiscoveryBudget: true,
        timeoutMs: pickerAgent.timeoutMs,
        temperature: 0.4,
        kind: 'producerPick',
        validate: (object: any) => !!(object?.id && seen.has(object.id)),
      });
      return {
        object: result.object,
        surfacedIds: [...seen.keys()],
        toolCalls: result.toolCalls.length,
      };
    },
    check: (out: any) => checkProducerPick(
      out?.object,
      new Set(out?.surfacedIds ?? []),
      out?.toolCalls ?? 0,
    ),
  };
}

interface Fact {
  ref: string;
  [key: string]: unknown;
}

const PRODUCER_CAPABILITY_BRIEFS: Record<string, string> = {
  weather: 'Air weather only when conditions have genuinely changed since the last mention.',
  news: 'Air one current story only when it is worth a listener’s attention; never turn the plan into a bulletin.',
};

function producerSegmentScenario(
  name: string,
  { staleWeather = false, includeNews = true, expectAir = true } = {},
) {
  return {
    name,
    run: async () => {
      const surfacedRefs = new Set<string>();
      const expose = (facts: Fact[]) => {
        for (const fact of facts) surfacedRefs.add(fact.ref);
        return { facts };
      };
      const tools: Record<string, any> = {
        getWeather: tool({
          description: 'Current local weather facts. Every fact carries a stable ref to cite in the plan.',
          inputSchema: z.object({}),
          execute: async () => expose([{
            ref: 'weather.current',
            location: 'Punjab',
            condition: staleWeather ? 'clear' : 'heavy rain',
            temperature: staleWeather ? 31 : 33,
            unit: 'C',
            changedSinceLastMention: !staleWeather,
          }]),
        }),
      };
      if (includeNews) tools.getNews = tool({
          description: 'Current news facts. Every fact carries a stable ref to cite in the plan.',
          inputSchema: z.object({}),
          execute: async () => expose([
            { ref: 'news.0', headline: 'Monsoon arrives early across north India', summary: 'Heavy rain arrived a week ahead of schedule.' },
            { ref: 'news.1', headline: 'Vinyl sales outpace CDs for third year', summary: 'Independent shops drove the increase.' },
          ]),
        });
      const offeredKinds = includeNews ? ['weather', 'news'] : ['weather'];
      const capabilityBriefs = offeredKinds
        .map(kind => `- ${kind}: ${PRODUCER_CAPABILITY_BRIEFS[kind]}`)
        .join('\n');
      const result = await djAgent({
        system: producerSegmentSystem(),
        messages: [{
          role: 'user',
          content: `Current track: Hanju — Amrinder Gill. Local time: 15:30.\n\nOffered capability briefs:\n${capabilityBriefs}\n\n${staleWeather ? 'Weather was mentioned recently and has not changed.' : 'No segment has aired recently.'}`,
        }],
        tools,
        schema: ProducerSegmentSchema,
        maxSteps: 2,
        timeoutMs: pickerAgent.timeoutMs,
        temperature: 0.3,
        kind: 'producerSegmentPlan',
      });
      return {
        object: result.object,
        offeredKinds,
        surfacedRefs: [...surfacedRefs],
        toolCalls: result.toolCalls.length,
      };
    },
    check: (out: any) => {
      const violations = checkProducerSegment(
        out?.object,
        new Set(out?.offeredKinds ?? []),
        new Set(out?.surfacedRefs ?? []),
        out?.toolCalls ?? 0,
      );
      if (out?.object?.air !== expectAir) violations.push(expectAir ? 'unexpected-silence' : 'unnecessary-segment');
      return violations;
    },
  };
}

const TAG_FIXTURES = [
  { title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', year: 2020, genre: 'Synthpop' },
  { title: 'Weightless', artist: 'Marconi Union', album: 'Weightless', year: 2011, genre: 'Ambient' },
  { title: 'Ace of Spades', artist: 'Motörhead', album: 'Ace of Spades', year: 1980, genre: 'Heavy Metal' },
  { title: 'A Change Is Gonna Come', artist: 'Sam Cooke', album: "Ain't That Good News", year: 1964, genre: 'Soul' },
  { title: 'Unknown Track', artist: 'Unknown Artist', album: 'Unknown Album', year: null, genre: null },
];

export const specs: KindSpec[] = [
  {
    kind: 'producerPick',
    group: 'producer',
    mode: 'agent',
    scenarios: [
      producerPickScenario(
        'flow-and-variety',
        'Now playing: Hanju by Amrinder Gill (92 BPM, key 8A, reflective, medium energy). Recent artists: Amrinder Gill, Manni Sandhu. Pick a fresh next track with compatible flow.',
      ),
      producerPickScenario(
        'show-constraint',
        'Now playing: Hanju by Amrinder Gill. Show brief: a late-night Punjabi journey, reflective or calm, avoid repeating the current artist. Pick the next track and plan its transition.',
      ),
    ],
  },
  {
    kind: 'producerSegmentPlan',
    group: 'producer',
    mode: 'agent',
    scenarios: [
      producerSegmentScenario('fresh-world-context'),
      producerSegmentScenario('stale-weather-stays-silent', {
        staleWeather: true,
        includeNews: false,
        expectAir: false,
      }),
    ],
  },
  {
    kind: 'producerLibraryTagBatch',
    group: 'producer',
    mode: 'any',
    scenarios: [{
      name: 'mixed-five-track-batch',
      run: () => tagBatch(TAG_FIXTURES),
      check: (out: any) => {
        if (!Array.isArray(out) || out.length !== TAG_FIXTURES.length) return ['tag-count-mismatch'];
        const violations: string[] = [];
        for (const [index, tag] of out.entries()) {
          if (!Array.isArray(tag?.moods)) violations.push('invalid-moods');
          if (!['low', 'medium', 'high'].includes(tag?.energy)) violations.push('invalid-energy');
          if (index < TAG_FIXTURES.length - 1 && tag?.moods?.length === 0) violations.push('empty-known-moods');
        }
        return [...new Set(violations)];
      },
    }],
  },
];
