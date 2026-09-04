// dj-personality-bench-v2.ts — PRODUCTION-PATH benchmark for evaluating a
// STRONGER local model against the REAL latency budget verified in the
// actual running code (broadcast/queue.ts): breaks are pre-rendered and held
// as _pendingVoice until the next eligible track boundary, with a 20-minute
// staleness cap (PENDING_VOICE_MAX_AGE_MS) enforced before airing — nothing
// about slow generation can block continuous playback (maybeAutonomousBreak
// is fired with `void`, never awaited on the playback-critical path). So
// this script does NOT impose an artificial per-call timeout the way the
// original bench did — a call is allowed to take as long as it takes.
//
// Calls the REAL generateBreakCopy/decideBreak (broadcast/dj-agent/
// talk-decision.ts) — same as the production-path version — so the
// verbatim-copy guard and the atmospheric-prose backstop are genuinely
// exercised, not approximated. Does NOT touch ElevenLabs, the live station,
// or persisted settings/session state (persona passed as an explicit
// override, never via session.start()).
//
// Run, INSIDE THE CONTROLLER CONTAINER — no outer `timeout` wrapper needed,
// but redirect to a file and let it run; each DJ/situation result prints
// (and is flushed to the file) as soon as it completes, so nothing is lost
// even if you need to check progress or the connection drops:
//   docker exec sub-wave-controller env BENCH_MODEL=qwen3:8b npx tsx dj-personality-bench-v2.ts > ~/bench-qwen3-v2.txt 2>&1 &
//   (the trailing & backgrounds it — tail -f ~/bench-qwen3-v2.txt to watch)

import * as settings from './src/settings.js';
import { generateBreakCopy, decideBreak } from './src/broadcast/dj-agent/talk-decision.js';

const MODEL = process.env.BENCH_MODEL || 'qwen3:8b';
const DJ_NAMES = [
  'Marcus Reed', 'Simone Ellis', 'Eric Jordan', 'Miss Renee Cole',
  'Nicole James', 'Julian Cross', 'Winslow the Cypher', 'Bellamy tha Blueprint',
];

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

// A real, plausible direct-address listener compliment — tests the
// direct-address rule (respond to the person, not report on them) and the
// verbatim-paraphrase guard, same shape a real approved Talk Wave item has.
const LISTENER_COMPLIMENT = {
  kind: 'message' as const,
  id: 999001,
  listenerName: 'Danielle',
  category: 'compliment',
  message: "You always pick the best songs for a rainy afternoon, I never skip when you're on.",
};

function fmtMs(ms: number) {
  return ms >= 60000 ? `${(ms / 60000).toFixed(1)}min` : `${(ms / 1000).toFixed(1)}s`;
}

async function runOne(label: string, purpose: 'BACKSELL' | 'LISTENER', persona: any, pendingMessage: any) {
  const queue = mockQueue();
  const t0 = Date.now();
  try {
    const text = await generateBreakCopy(purpose, queue, {} as any, pendingMessage, persona);
    const ms = Date.now() - t0;
    if (text === null) {
      console.log(`— ${label}  [${purpose}]  (${fmtMs(ms)})  REJECTED by production guard — safe outcome, nothing would air`);
      if (queue._logs.length) console.log(`   reason: ${queue._logs.join(' | ')}`);
    } else {
      console.log(`— ${label}  [${purpose}]  (${fmtMs(ms)})`);
      console.log(`   "${text}"`);
    }
  } catch (err: any) {
    const ms = Date.now() - t0;
    console.log(`— ${label}  [${purpose}]  (${fmtMs(ms)})  FAILED: ${err?.message || err}`);
  }
  console.log('');
}

async function main() {
  await settings.load();
  const s: any = settings.get();
  s.llm.provider = 'ollama';
  s.llm.model = MODEL;

  console.log(`\nBenchmarking model (PRODUCTION PATH, no artificial timeout): ollama:${MODEL}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  for (const name of DJ_NAMES) {
    const persona = (s.personas || []).find((p: any) => p.name === name);
    if (!persona) {
      console.log(`— ${name}: NOT FOUND in live personas list, skipping\n`);
      continue;
    }
    await runOne(name, 'BACKSELL', persona, null);
    await runOne(name, 'LISTENER', persona, LISTENER_COMPLIMENT);
  }

  console.log('--- NO_BREAK production-path check ---');
  {
    const queue = mockQueue();
    const t0 = Date.now();
    try {
      const decision = await decideBreak(queue, {} as any, null);
      const ms = Date.now() - t0;
      console.log(`decideBreak (${fmtMs(ms)}) → purpose: ${decision.purpose}  reason: ${decision.reason}`);
    } catch (err: any) {
      console.log(`decideBreak FAILED: ${err?.message || err}`);
    }
  }

  console.log(`\nFinished: ${new Date().toISOString()}`);
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
