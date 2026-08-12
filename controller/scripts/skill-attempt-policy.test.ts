import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INFRASTRUCTURE_RETRY_CEILING_MS,
  researchAttemptDelayMs,
  researchAttemptsFromToolCalls,
} from '../src/skills/attempt-policy.js';

const caps = [
  { kind: 'now-playing-dig', toolName: 'skill_now_playing_dig' },
  { kind: 'web-search', toolName: 'skill_web_search' },
  { kind: 'weather', toolName: 'skill_weather' },
];

test('completed empty research still records a completed attempt', () => {
  assert.deepEqual(researchAttemptsFromToolCalls(caps, [{
    name: 'skill_now_playing_dig',
    result: { available: false, reason: 'no exact-track evidence' },
  }]), [{ kind: 'now-playing-dig', outcome: 'completed' }]);
});

test('an all-error tool sequence is an infrastructure failure', () => {
  assert.deepEqual(researchAttemptsFromToolCalls(caps, [
    { name: 'skill_web_search', result: { error: 'search provider timed out' } },
    { name: 'skill_web_search', result: { error: 'search provider timed out again' } },
  ]), [{ kind: 'web-search', outcome: 'infrastructure-failure' }]);
});

test('a successful retry makes the overall attempt completed', () => {
  assert.deepEqual(researchAttemptsFromToolCalls(caps, [
    { name: 'skill_web_search', result: { error: 'temporary outage' } },
    { name: 'skill_web_search', result: { answer: '', sources: [] } },
  ]), [{ kind: 'web-search', outcome: 'completed' }]);
});

test('unrelated and uncalled tools do not create attempts', () => {
  assert.deepEqual(researchAttemptsFromToolCalls(caps, [
    { name: 'done', result: { air: false } },
  ]), []);
});

test('completed attempts use normal cooldown and infrastructure retries are capped', () => {
  const hour = 60 * 60 * 1000;
  assert.equal(researchAttemptDelayMs('completed', hour), hour);
  assert.equal(researchAttemptDelayMs('infrastructure-failure', hour), INFRASTRUCTURE_RETRY_CEILING_MS);
  assert.equal(researchAttemptDelayMs('infrastructure-failure', 5 * 60 * 1000), 5 * 60 * 1000);
  assert.equal(researchAttemptDelayMs('completed', 0), 0);
});
