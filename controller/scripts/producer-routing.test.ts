// Optional Producer LLM routing. This pins the compatibility promise: an
// untouched station still uses the primary Persona connection, while an
// explicitly enabled Producer gets its own connection and falls back safely.
// Settings assertions are cold-load checks because the explicit llm load
// composition is where new nested fields have historically gone missing.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const stateRoot = mkdtempSync(path.join(tmpdir(), 'subwave-producer-routing-'));
process.env.STATE_DIR = stateRoot;

const { setCache } = await import('../src/settings/store.js');
const settings = await import('../src/settings.js');
const {
  primaryLeg,
  producerLeg,
  promptDiscoverySteps,
  producerPromptDiscoverySteps,
} = await import('../src/llm/internal/provider/legs.js');
const { withFailover } = await import('../src/llm/internal/core/failover.js');

const SETTINGS_PATH = path.join(stateRoot, 'settings.json');
const PRIMARY = {
  provider: 'openai-compatible',
  model: 'qwen3-8b',
  baseUrl: 'http://persona:8080/v1',
  discoverySteps: 3,
};
const PRODUCER = {
  enabled: true,
  provider: 'openai-compatible',
  model: 'qwen3-4b',
  baseUrl: 'http://producer:8080/v1',
  reasoning: false,
  toolChoice: 'auto',
  numCtx: 16384,
  repeatPenalty: 1.08,
  discoverySteps: 2,
};

async function coldLoad(extra: Record<string, unknown> = {}) {
  writeFileSync(SETTINGS_PATH, JSON.stringify({ llm: { ...PRIMARY, ...extra } }));
  setCache(null);
  await settings.load();
  return settings.get().llm;
}

test('Producer is disabled by default and resolves to the primary Persona leg', async () => {
  const llm = await coldLoad();
  assert.equal(llm.producer.enabled, false);
  assert.equal(producerLeg().slot, 'primary');
  assert.equal(producerLeg().label, primaryLeg().label);
  assert.equal(producerPromptDiscoverySteps(), promptDiscoverySteps());
});

test('the complete Producer connection survives a controller restart', async () => {
  const llm = await coldLoad({ producer: PRODUCER });
  assert.deepEqual(
    {
      enabled: llm.producer.enabled,
      provider: llm.producer.provider,
      model: llm.producer.model,
      baseUrl: llm.producer.baseUrl,
      reasoning: llm.producer.reasoning,
      toolChoice: llm.producer.toolChoice,
      numCtx: llm.producer.numCtx,
      repeatPenalty: llm.producer.repeatPenalty,
      discoverySteps: llm.producer.discoverySteps,
    },
    PRODUCER,
  );
  const leg = producerLeg();
  assert.equal(leg.slot, 'producer');
  assert.equal(leg.cfg.model, PRODUCER.model);
  assert.equal(leg.cfg.baseUrl, PRODUCER.baseUrl);
});

test('saving Producer settings applies immediately and survives the next restart', async () => {
  await coldLoad();
  await settings.update({ llm: { producer: PRODUCER } } as never);
  assert.equal(settings.get().llm.producer.model, PRODUCER.model);

  setCache(null);
  await settings.load();
  assert.equal(settings.get().llm.producer.enabled, true);
  assert.equal(settings.get().llm.producer.baseUrl, PRODUCER.baseUrl);
  assert.equal(settings.get().llm.producer.discoverySteps, 2);
});

test('an enabled OpenAI-compatible Producer requires its own URL', async () => {
  await coldLoad();
  await assert.rejects(
    settings.update({
      llm: {
        producer: {
          enabled: true,
          provider: 'openai-compatible',
          model: 'qwen3-4b',
        },
      },
    } as never),
    /llm\.producer\.baseUrl is required/,
  );
});

test('Producer prompts promise the smaller Producer/Persona discovery budget', async () => {
  await coldLoad({ producer: PRODUCER });
  assert.equal(producerPromptDiscoverySteps(), 2);

  await coldLoad({ producer: { ...PRODUCER, discoverySteps: 5 } });
  assert.equal(producerPromptDiscoverySteps(), 3, 'primary safety hop narrows the promise');
});

test('Producer role starts on Producer and does not disturb Persona routing', async () => {
  await coldLoad({ producer: PRODUCER });
  const producerSlots: string[] = [];
  const producerResult = await withFailover(
    'test.producer-success',
    () => ({}),
    async (leg) => {
      producerSlots.push(leg.slot);
      return { value: 'producer-ok', via: 'test' };
    },
    undefined,
    'producer',
  );
  assert.equal(producerResult, 'producer-ok');
  assert.deepEqual(producerSlots, ['producer']);

  const personaSlots: string[] = [];
  await withFailover(
    'test.persona-unchanged',
    () => ({}),
    async (leg) => {
      personaSlots.push(leg.slot);
      return { value: 'persona-ok', via: 'test' };
    },
  );
  assert.deepEqual(personaSlots, ['primary']);
});

test('an unreachable Producer retries once on the primary Persona leg', async () => {
  await coldLoad({ producer: PRODUCER });
  const slots: string[] = [];
  const result = await withFailover(
    'test.producer-fallback',
    () => ({}),
    async (leg) => {
      slots.push(leg.slot);
      if (leg.slot === 'producer') {
        const err = new Error('connect ECONNREFUSED producer:8080') as Error & { code?: string };
        err.code = 'ECONNREFUSED';
        throw err;
      }
      return { value: 'primary-ok', via: 'test' };
    },
    undefined,
    'producer',
  );
  assert.equal(result, 'primary-ok');
  assert.deepEqual(slots, ['producer', 'primary']);
});

test('Producer API keys use the shared provider key store and stay redacted', async () => {
  await coldLoad({
    keys: { 'openai-compatible': 'sk-local-producer' },
    producer: PRODUCER,
  });
  assert.equal(producerLeg().cfg.apiKey, 'sk-local-producer');
  assert.equal(settings.getRedacted().llm.producer.apiKey, 'set');
  assert.ok(!JSON.stringify(settings.getRedacted()).includes('sk-local-producer'));

  // Backup restore replays this redacted object through update(). The 'set'
  // sentinel must remain a no-op for the Producer just as it is for both
  // established legs, or restoring a backup would silently drop the key.
  await settings.update(JSON.parse(JSON.stringify(settings.getRedacted())));
  assert.equal(settings.get().llm.keys['openai-compatible'], 'sk-local-producer');
});
