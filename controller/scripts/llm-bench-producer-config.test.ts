import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyProducerCandidate,
  producerCandidateFromArgs,
} from './llm-bench/producer-config.js';

test('no explicit Producer leaves the benchmark on the all-in-one path', () => {
  assert.equal(producerCandidateFromArgs({}, {}), null);
  const llm = { producer: { enabled: true, model: 'saved-station-model' } };
  applyProducerCandidate(llm, null);
  assert.equal(llm.producer.enabled, false, 'saved station config cannot hijack a matrix run');
});

test('an explicit OpenAI-compatible Producer is parsed and applied in memory', () => {
  const candidate = producerCandidateFromArgs({
    'producer-model': 'openai-compatible:/models/Qwen3-4B-Q4_K_M.gguf',
    'producer-base-url': 'http://doc.home:8090/v1/',
    'producer-reasoning': 'off',
    'producer-num-ctx': '16384',
  }, {});
  assert.deepEqual(candidate, {
    spec: 'openai-compatible:/models/Qwen3-4B-Q4_K_M.gguf',
    provider: 'openai-compatible',
    model: '/models/Qwen3-4B-Q4_K_M.gguf',
    baseUrl: 'http://doc.home:8090/v1',
    reasoning: false,
    numCtx: 16384,
  });

  const llm = { producer: { enabled: false, model: '', baseUrl: '', reasoning: true } };
  applyProducerCandidate(llm, candidate);
  assert.deepEqual(llm.producer, {
    enabled: true,
    provider: 'openai-compatible',
    model: '/models/Qwen3-4B-Q4_K_M.gguf',
    baseUrl: 'http://doc.home:8090/v1',
    reasoning: false,
    numCtx: 16384,
  });
});

test('the Producer URL may come from a dedicated environment override', () => {
  const candidate = producerCandidateFromArgs(
    { 'producer-model': 'openai-compatible:qwen3-4b' },
    { PRODUCER_LLM_BASE_URL: 'http://producer:8080/v1' },
  );
  assert.equal(candidate?.baseUrl, 'http://producer:8080/v1');
});

test('bad or ambiguous Producer configurations fail before the matrix starts', () => {
  assert.throws(
    () => producerCandidateFromArgs({ 'producer-base-url': 'http://producer:8080/v1' }, {}),
    /--producer-model is required/,
  );
  assert.throws(
    () => producerCandidateFromArgs({ 'producer-model': 'openai-compatible:qwen3-4b' }, {}),
    /--producer-base-url/,
  );
  assert.throws(
    () => producerCandidateFromArgs({
      'producer-model': 'openai-compatible:qwen3-4b',
      'producer-base-url': 'file:///tmp/model',
    }, {}),
    /must start with http/,
  );
  assert.throws(
    () => producerCandidateFromArgs({
      'producer-model': 'ollama:qwen3:4b',
      'producer-reasoning': 'sometimes',
    }, {}),
    /producer-reasoning/,
  );
});
