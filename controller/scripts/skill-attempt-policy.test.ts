import assert from 'node:assert/strict';
import test from 'node:test';

import {
  directResearchAttempt,
  hasRequiredEvidence,
  INFRASTRUCTURE_RETRY_CEILING_MS,
  researchAttemptDelayMs,
  researchAttemptsFromToolCalls,
} from '../src/skills/attempt-policy.js';

const caps = [
  { kind: 'now-playing-dig-v2', toolName: 'skill_now_playing_dig_v2', cooldownOnAttempt: true },
  { kind: 'web-search', toolName: 'skill_web_search', cooldownOnAttempt: false },
];

test('completed empty opt-in research records a completed attempt', () => {
  assert.deepEqual(researchAttemptsFromToolCalls(caps, [{
    name: 'skill_now_playing_dig_v2',
    result: { available: false, reason: 'no exact-track evidence' },
  }]), [{ kind: 'now-playing-dig-v2', outcome: 'completed' }]);
});

test('legacy and uncalled tools do not create attempts', () => {
  assert.deepEqual(researchAttemptsFromToolCalls(caps, [
    { name: 'skill_web_search', result: { answer: '', sources: [] } },
    { name: 'done', result: { air: false } },
  ]), []);
});

test('all-error agent calls and direct calls are infrastructure failures', () => {
  assert.deepEqual(researchAttemptsFromToolCalls(caps, [{
    name: 'skill_now_playing_dig_v2', result: { error: 'provider timed out' },
  }]), [{ kind: 'now-playing-dig-v2', outcome: 'infrastructure-failure' }]);
  assert.deepEqual(directResearchAttempt(caps[0], { error: 'provider timed out' }), [{
    kind: 'now-playing-dig-v2', outcome: 'infrastructure-failure',
  }]);
});

test('a successful retry makes an agentic attempt completed', () => {
  assert.deepEqual(researchAttemptsFromToolCalls(caps, [
    { name: 'skill_now_playing_dig_v2', result: { error: 'temporary outage' } },
    { name: 'skill_now_playing_dig_v2', result: { available: false } },
  ]), [{ kind: 'now-playing-dig-v2', outcome: 'completed' }]);
});

test('completed attempts use normal cooldown and infrastructure retries are capped', () => {
  const hour = 60 * 60 * 1000;
  assert.equal(researchAttemptDelayMs('completed', hour), hour);
  assert.equal(researchAttemptDelayMs('infrastructure-failure', hour), INFRASTRUCTURE_RETRY_CEILING_MS);
  assert.equal(researchAttemptDelayMs('infrastructure-failure', 5 * 60 * 1000), 5 * 60 * 1000);
});

test('required evidence must come from the selected skill tool and be explicitly available', () => {
  const cap = { ...caps[0], requiresEvidence: true };
  assert.equal(hasRequiredEvidence(cap, []), false);
  assert.equal(hasRequiredEvidence(cap, [{
    name: cap.toolName, result: { available: false, reason: 'no exact match' },
  }]), false);
  assert.equal(hasRequiredEvidence(cap, [{
    name: cap.toolName, result: { available: true, claims: [{ text: 'supported' }] },
  }]), true);
  assert.equal(hasRequiredEvidence({ ...cap, requiresEvidence: false }, []), true);
});
