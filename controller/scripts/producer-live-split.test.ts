import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.STATE_DIR = mkdtempSync(path.join(tmpdir(), 'subwave-producer-live-split-'));

const settings = await import('../src/settings.js');
await settings.load();
const {
  pickerAgent,
  producerPickerAgent,
  producerPickerSystem,
} = await import('../src/broadcast/dj-agent/agents.js');
const { producerBriefClause } = await import('../src/llm/internal/prompts/scripts.js');

test('live picker agents declare separate Persona and Producer routes', () => {
  assert.equal(pickerAgent.role, 'persona');
  assert.equal(producerPickerAgent.role, 'producer');
  assert.equal(producerPickerAgent.kind, 'djProducerPick');
});

test('the Producer picker system excludes the on-air Persona preamble', () => {
  const system = producerPickerSystem(null, false);
  const personaPreamble = settings.agentPersonaPreamble(settings.getEffectivePersona());
  assert.ok(personaPreamble.length > 20);
  assert.ok(!system.includes(personaPreamble));
  assert.match(system, /backstage Producer/i);
  assert.match(system, /speechBrief/);
  assert.match(system, /rather than a script/i);
});

test('the Persona bridge carries only one compact editorial direction', () => {
  const raw = `  Notice the warmer pulse.\n\n${'x'.repeat(300)}`;
  const clause = producerBriefClause(raw);
  assert.match(clause, /^ Backstage editorial direction:/);
  assert.match(clause, /Treat it as an angle, not wording to quote or explain/);
  assert.ok(!clause.includes('\n'));
  const quoted = clause.match(/direction: "([\s\S]*)"\. Treat/)?.[1] ?? '';
  assert.equal(quoted.length, 240);
  assert.equal(producerBriefClause(null), '');
});
