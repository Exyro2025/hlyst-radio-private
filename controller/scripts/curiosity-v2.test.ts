import assert from 'node:assert/strict';
import test from 'node:test';

import {
  onThisDayEvidence,
  selectFreshOnThisDay,
  type CuriosityItem,
} from '../src/skills/curiosity.js';

const items: CuriosityItem[] = [
  { source: 'on-this-day', year: 1969, text: 'The first example was broadcast.' },
  { source: 'on-this-day', year: 1981, text: 'The second example was launched.' },
];

test('selects only one fresh event', () => {
  assert.equal(selectFreshOnThisDay(items, (text) => text.includes('first')), items[1]);
});

test('an exhausted pool remains unavailable to the caller', () => {
  assert.equal(selectFreshOnThisDay(items, () => true), null);
});

test('binds the exact event and year to the date-specific Wikimedia source', () => {
  const evidence = onThisDayEvidence(items[0], new Date('2026-08-14T12:00:00Z'));
  assert.equal(evidence.available, true);
  if (!evidence.available) return;
  assert.equal(evidence.claims.length, 1);
  assert.equal(evidence.claims[0]?.text, 'On this day in 1969, The first example was broadcast.');
  assert.equal(evidence.claims[0]?.sourceIds.length, 1);
  assert.match(evidence.sources[0]?.url || '', /onthisday\/events\/08\/14$/);
});
