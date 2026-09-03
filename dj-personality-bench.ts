// dj-personality-bench.ts — controlled TEXT-ONLY benchmark: same fixed
// context, 6 real named DJs, current local model. Does NOT touch ElevenLabs,
// does NOT touch the live station, does NOT change any persisted settings —
// settings.llm is overridden only in this process's memory for the duration
// of the run (same technique llm-bench/cli.ts uses).
//
// Uses the REAL shared prompt-building functions (agentPersonaPreamble,
// vernacularClause, recognizedNamesClause) with each DJ's REAL soul/tone
// data from live settings — not hand-reconstructed guesses. This does not
// run through session.ts's full session/schedule machinery (that's deeply
// coupled to live schedule state, too risky to hack into for a diagnostic
// script) — so it is a faithful reconstruction of the real prompt shape,
// not byte-identical to the full production call site.
//
// Run, INSIDE THE CONTROLLER CONTAINER:
//   docker exec sub-wave-controller npx tsx dj-personality-bench.ts
//
// To test a second (stronger) model after pulling it via `ollama pull`, set:
//   docker exec sub-wave-controller env BENCH_MODEL=qwen2.5:7b npx tsx dj-personality-bench.ts
import * as settings from './src/settings.js';
import * as memory from './src/broadcast/dj-agent/dj-memory.js';
import { djObject } from './src/llm/sdk.js';
import { z } from 'zod';

const MODEL = process.env.BENCH_MODEL || 'llama3.2:3b';
const DJ_NAMES = ['Marcus Reed', 'Eric Jordan', 'Miss Renee Cole', 'Nicole James', 'Julian Cross', 'Winslow the Cypher'];

const copySchema = z.object({
  text: z.string().describe('the exact words the DJ says on air — concise, in character, present tense'),
});

// Identical shared context for every DJ — same track just played, same track
// up next, same purpose. Any difference in output is attributable to the
// persona, not the situation.
const SHARED_CONTEXT = `On air: {NAME}.
Currently playing: "Got It Bad" by HLYST.
Up next: "Rhodes After Dark" by HLYST.
Recent artists played: HLYST, HLYST, Tarvona.
No recent on-air talk this session.
No DJ changeover is imminent.
No approved Talk Wave listener message is waiting.

Purpose: BACKSELL. Credit the track that just played — title and artist, briefly, in your own voice.`;

async function main() {
  await settings.load();
  const s: any = settings.get();
  s.llm.provider = 'ollama';
  s.llm.model = MODEL;

  console.log(`\nBenchmarking model: ollama:${MODEL}\n`);

  for (const name of DJ_NAMES) {
    const persona = (s.personas || []).find((p: any) => p.name === name);
    if (!persona) {
      console.log(`— ${name}: NOT FOUND in live personas list, skipping`);
      continue;
    }

    const system = `${settings.agentPersonaPreamble(persona)}

Write ONE short, natural on-air line for a standalone talk break. Never
identify or imply that you are AI. Never explain "energy" or "journeys" or
why an algorithm picked anything. Never invent artist facts, chart
positions, quotes, listener messages, or anything not given to you.

${memory.vernacularClause()}

${memory.recognizedNamesClause()}`;

    const prompt = SHARED_CONTEXT.replace('{NAME}', name);
    const t0 = Date.now();
    try {
      const out = await djObject({ system, prompt, schema: copySchema, temperature: 0.7, kind: 'benchDjPersonality' });
      const ms = Date.now() - t0;
      console.log(`— ${name}  (${ms}ms)`);
      console.log(`   "${out?.text || '(empty)'}"\n`);
    } catch (err: any) {
      const ms = Date.now() - t0;
      console.log(`— ${name}  (${ms}ms)  FAILED: ${err?.message || err}\n`);
    }
  }
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
