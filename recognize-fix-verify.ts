// recognize-fix-verify.ts — narrow, one-purpose verification for the
// matchRecognizedPerson fix (dj-memory.ts). NOT a model/personality test —
// uses whatever model settings already has configured. Calls the REAL
// generateBreakCopy, same as production, persona passed as an explicit
// override (no live session/schedule state touched).
//
// Run, INSIDE THE CONTROLLER CONTAINER:
//   docker exec sub-wave-controller npx tsx recognize-fix-verify.ts

import * as settings from './src/settings.js';
import { generateBreakCopy } from './src/broadcast/dj-agent/talk-decision.js';

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

async function run(label: string, purpose: 'BACKSELL' | 'LISTENER', persona: any, pendingMessage: any) {
  const queue = mockQueue();
  const t0 = Date.now();
  try {
    const text = await generateBreakCopy(purpose, queue, {} as any, pendingMessage, persona);
    const ms = Date.now() - t0;
    console.log(`— ${label}  (${ms}ms)`);
    console.log(text === null ? `   REJECTED (safe) — ${queue._logs.join(' | ')}` : `   "${text}"`);
  } catch (err: any) {
    console.log(`— ${label}  FAILED: ${err?.message || err}`);
  }
  console.log('');
}

async function main() {
  await settings.load();
  const s: any = settings.get();
  const persona = (s.personas || [])[0];
  if (!persona) { console.log('No personas found — cannot verify.'); return; }
  console.log(`Using persona: ${persona.name}\n`);

  // Requirement 8: routine non-listener break still completes.
  await run('Routine BACKSELL (no listener message)', 'BACKSELL', persona, null);

  // Requirement 4/6: text message from each recognized name.
  for (const name of ['Australia Lawrence', 'Christopher', 'Jalen Edwards']) {
    await run(`LISTENER text message from "${name}"`, 'LISTENER', persona, {
      kind: 'message', id: 1, listenerName: name, category: 'compliment',
      message: 'Loving the set today, keep it up!',
    });
  }

  // Requirement 5: unknown listener must not falsely match / must not crash.
  await run('LISTENER text message from unknown listener "Pat Smith"', 'LISTENER', persona, {
    kind: 'message', id: 2, listenerName: 'Pat Smith', category: 'compliment',
    message: 'Great show today!',
  });

  // Requirement 7: voice-note kind, one recognized name, must not crash.
  await run('LISTENER voice_note from "Jalen Edwards"', 'LISTENER', persona, {
    kind: 'voice_note', id: 3, listenerName: 'Jalen Edwards', category: 'compliment',
    message: 'Hey this is Jalen, really enjoying the station lately.',
  });

  console.log('Done. No FAILED lines above = the crash is fixed.');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
