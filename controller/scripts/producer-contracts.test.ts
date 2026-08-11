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
    speechBrief: 'Notice the warmer pulse without naming the previous track.',
    transition: 'blend',
  };
  assert.equal(ProducerPickSchema.safeParse(pick).success, true);
  assert.deepEqual(checkProducerPick(pick, new Set(['track-1']), 1), []);
});

test('Producer pick reports missing discovery and an invented id', () => {
  const pick = { id: 'invented', reason: 'fits', speechBrief: null, transition: null };
  assert.deepEqual(checkProducerPick(pick, new Set(['real']), 0), [
    'no-discovery-tool',
    'ungrounded-track-id',
  ]);
});

test('Producer segment requires offered kinds and surfaced fact references', () => {
  const plan = {
    air: true,
    kind: 'weather',
    factRefs: ['weather.current'],
    angle: 'Connect the sudden rain to the track’s reflective pace.',
    reason: 'conditions changed',
  };
  assert.equal(ProducerSegmentSchema.safeParse(plan).success, true);
  assert.deepEqual(checkProducerSegment(
    plan,
    new Set(['weather']),
    new Set(['weather.current']),
    1,
  ), []);
});

test('Producer segment silence carries no unused editorial payload', () => {
  const plan = {
    air: false,
    kind: 'news',
    factRefs: ['news.0'],
    angle: 'Read the headline.',
    reason: 'not worthwhile',
  };
  assert.deepEqual(checkProducerSegment(
    plan,
    new Set(['news']),
    new Set(['news.0']),
    1,
  ), [
    'silent-segment-has-kind',
    'silent-segment-has-facts',
    'silent-segment-has-angle',
  ]);
});

test('Producer prompt names the real discovery budget and forbids on-air copy', () => {
  const prompt = producerPickSystem(3);
  assert.match(prompt, /up to 3 discovery rounds/);
  assert.match(prompt, /Never imitate the presenter/);
  assert.match(prompt, /rather than a script/);
});
