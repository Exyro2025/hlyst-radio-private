import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProducerPickSchema,
  ProducerSegmentSchema,
  checkProducerPick,
  checkProducerSegment,
  producerPickSystem,
} from '../src/llm/producer.js';

test('Producer pick accepts a grounded backstage decision', () => {
  const pick = {
    id: 'track-1',
    reason: 'new artist, gently lifts energy',
    transition: 'blend',
  };
  assert.equal(ProducerPickSchema.safeParse(pick).success, true);
  assert.deepEqual(checkProducerPick(pick, new Set(['track-1']), 1), []);
});

test('Producer pick reports missing discovery and an invented id', () => {
  const pick = { id: 'invented', reason: 'fits', transition: null };
  assert.deepEqual(checkProducerPick(pick, new Set(['real']), 0), [
    'no-discovery-tool',
    'ungrounded-track-id',
  ]);
});

test('Producer segment requires an offered, researched kind', () => {
  const plan = {
    air: true,
    kind: 'weather',
    reason: 'conditions changed',
    sfx: null,
  };
  assert.equal(ProducerSegmentSchema.safeParse(plan).success, true);
  assert.deepEqual(checkProducerSegment(
    plan,
    new Set(['weather']),
    new Set(['weather']),
    1,
  ), []);
});

test('Producer segment silence carries no unused production payload', () => {
  const plan = {
    air: false,
    kind: 'news',
    reason: 'not worthwhile',
    sfx: 'sting',
  };
  assert.deepEqual(checkProducerSegment(
    plan,
    new Set(['news']),
    new Set(['news']),
    1,
    new Set(['sting']),
  ), [
    'silent-segment-has-kind',
    'silent-segment-has-sfx',
  ]);
});

test('Producer segment can select an offered prompt-only kind without a tool call', () => {
  const plan = {
    air: true,
    kind: 'listener-mailbag',
    reason: 'the supplied brief calls for it',
    sfx: null,
  };
  assert.deepEqual(checkProducerSegment(
    plan,
    new Set(['listener-mailbag']),
    new Set(),
    0,
    new Set(),
    false,
  ), []);
});

test('Producer prompt names the real discovery budget and forbids on-air planning', () => {
  const prompt = producerPickSystem(3);
  assert.match(prompt, /up to 3 discovery rounds/);
  assert.match(prompt, /Never imitate the presenter/);
  assert.match(prompt, /Do not plan, suggest or write anything/i);
  assert.ok(!prompt.includes('speechBrief'));
});
