// dj-personality-bench.ts — PRODUCTION-PATH benchmark: calls the REAL
// generateBreakCopy/decideBreak from broadcast/dj-agent/talk-decision.ts —
// the same functions the live autonomous break cycle uses — instead of
// reconstructing the prompt by hand. This means the verbatim-copy guard,
// the atmospheric-prose backstop (djObject), and JSON repair are all
// genuinely exercised, not approximated.
//
// Still does NOT touch ElevenLabs, the live station, or any persisted
// settings/session state:
//   - settings.llm is overridden only in this process's memory (unchanged
//     technique from before).
//   - the persona is passed as an explicit override param (generateBreakCopy/
//     decisionContext's new personaOverride argument) rather than by mutating
//     broadcast/session.ts's live on-air session — so this never calls
//     session.start() and never writes a session file to disk.
//   - `queue` is a minimal in-memory stand-in (fixed current/upcoming track,
//     no-op log/getDjRecap) — never the real queue singleton, so nothing here
//     can touch the real broadcast/library state.
//
// Run, INSIDE THE CONTROLLER CONTAINER:
//   docker exec sub-wave-controller npx tsx dj-personality-bench.ts
//
// To test a second (stronger) model after pulling it via `ollama pull`, set:
//   docker exec sub-wave-controller env BENCH_MODEL=qwen2.5:7b npx tsx dj-personality-bench.ts

import * as settings from './src/settings.js';
import { generateBreakCopy, decideBreak } from './src/broadcast/dj-agent/talk-decision.js';

const MODEL = process.env.BENCH_MODEL || 'llama3.2:3b';
const DJ_NAMES = ['Marcus Reed', 'Eric Jordan', 'Miss Renee Cole', 'Nicole James', 'Julian Cross', 'Winslow the Cypher'];

// Minimal queue stand-in — only the members decisionContext() actually reads.
// No disk I/O, no live queue/library access.
function mockQueue() {
  const logs: string[] = [];
  return {
    current: { track: { title: 'Got It Bad', artist: 'HLYST' } },
    upcoming: [{ track: { title: 'Rhodes After Dark', artist: 'HLYST' } }],
    getDjRecap: () => '',
    getRecentArtists: () => ['HLYST', 'HLYST', 'Tarvona'],
    getLastTalkBreakAt: () => 0,
    log: (kind: string, msg: string) => logs.push(`[${kind}] ${msg}`),
    _logs: logs,
  };
}

// A context engineered to plausibly justify NO_BREAK: no recent talk, no
// pending listener message, no imminent handoff — nothing but ordinary music
// continuing. Same shared shape as the BACKSELL queue above so this is a
// fair, faithful call into the real decideBreak(), not a rigged one.
function mockQueueForNoBreakCheck() {
  return mockQueue();
}

async function main() {
  await settings.load();
  const s: any = settings.get();
  s.llm.provider = 'ollama';
  s.llm.model = MODEL;

  console.log(`\nBenchmarking model (PRODUCTION PATH): ollama:${MODEL}\n`);

  // --- Per-DJ BACKSELL test — the real generateBreakCopy(), persona-overridden ---
  for (const name of DJ_NAMES) {
    const persona = (s.personas || []).find((p: any) => p.name === name);
    if (!persona) {
      console.log(`— ${name}: NOT FOUND in live personas list, skipping`);
      continue;
    }
    const queue = mockQueue();
    const t0 = Date.now();
    try {
      const text = await generateBreakCopy('BACKSELL', queue, {} as any, null, persona);
      const ms = Date.now() - t0;
      if (text === null) {
        console.log(`— ${name}  (${ms}ms)  REJECTED by production guard (verbatim/atmospheric backstop) — this is a SAFE outcome, nothing would air`);
        if (queue._logs.length) console.log(`   reason: ${queue._logs.join(' | ')}`);
      } else {
        console.log(`— ${name}  (${ms}ms)`);
        console.log(`   "${text}"`);
      }
    } catch (err: any) {
      const ms = Date.now() - t0;
      console.log(`— ${name}  (${ms}ms)  FAILED: ${err?.message || err}`);
    }
    console.log('');
  }

  // --- NO_BREAK path test — the real decideBreak(), ordinary/quiet context ---
  console.log('--- NO_BREAK production-path check ---');
  {
    const queue = mockQueueForNoBreakCheck();
    const t0 = Date.now();
    try {
      const decision = await decideBreak(queue, {} as any, null);
      const ms = Date.now() - t0;
      console.log(`decideBreak (${ms}ms) → purpose: ${decision.purpose}  reason: ${decision.reason}`);
    } catch (err: any) {
      console.log(`decideBreak FAILED: ${err?.message || err}`);
    }
  }
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
