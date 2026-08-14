import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMusicNewsReader,
  headlineMentionsArtist,
  type MusicNewsFeed,
} from '../src/skills/music-news.js';

const feeds: MusicNewsFeed[] = [
  { id: 'one', label: 'One', provider: 'one.test', url: 'https://one.test/feed' },
  { id: 'two', label: 'Two', provider: 'two.test', url: 'https://two.test/feed' },
];

test('artist matching requires the explicit whole artist name', () => {
  assert.equal(headlineMentionsArtist('Underworld announce a new record', 'Underworld'), true);
  assert.equal(headlineMentionsArtist('Arch Enemy play The Underworld', 'Underworld'), false);
  assert.equal(headlineMentionsArtist('Public service broadcasting changes', 'Public Service Broadcasting'), true);
  assert.equal(headlineMentionsArtist('Underworlds apart', 'Underworld'), false);
});

test('feeds refresh concurrently once, deduplicate, and carry provenance', async () => {
  let calls = 0;
  const reader = createMusicNewsReader({
    feeds,
    now: () => Date.parse('2026-08-14T10:00:00Z'),
    fetchFeed: async (feed) => {
      calls++;
      return [{
        title: 'Underworld announce a new record',
        description: 'not evidence',
        url: `https://${feed.provider}/story`,
        publishedAt: '2026-08-14T09:00:00.000Z',
      }];
    },
  });
  const [first, second] = await Promise.all([reader.latest(), reader.latest()]);
  assert.equal(calls, 2, 'one refresh should call each source exactly once');
  assert.equal(first.length, 1, 'same headline from two feeds should deduplicate');
  assert.deepEqual(second, first);
  const evidence = await reader.forArtist('Underworld');
  assert.equal(evidence.available, true);
  if (!evidence.available) return;
  assert.equal(evidence.claims[0].text, 'Underworld announce a new record');
  assert.equal(evidence.sources[0].url, 'https://one.test/story');
  assert.equal(evidence.sources[0].publishedAt, '2026-08-14T09:00:00.000Z');
  assert.ok(!JSON.stringify(evidence).includes('not evidence'));
});

test('one failed publisher does not suppress another publisher', async () => {
  let calls = 0;
  const reader = createMusicNewsReader({
    feeds,
    fetchFeed: async (feed) => {
      calls++;
      if (feed.id === 'one') throw new Error('publisher unavailable');
      return [{ title: 'Björk announces a new tour', description: '', url: 'https://two.test/bjork' }];
    },
  });
  const evidence = await reader.forArtist('Björk');
  assert.equal(evidence.available, true);
  await reader.forArtist('Björk');
  assert.equal(calls, 2, 'a failed publisher receives a retry cache too');
});

test('successful cached data bridges a temporary publisher failure', async () => {
  let clock = 1_000_000;
  let fail = false;
  const reader = createMusicNewsReader({
    feeds: [feeds[0]],
    now: () => clock,
    cacheMs: 100,
    fetchFeed: async () => {
      if (fail) throw new Error('temporary outage');
      return [{ title: 'Deftones announce a new record', description: '', url: 'https://one.test/deftones' }];
    },
  });
  assert.equal((await reader.latest()).length, 1);
  clock += 101;
  fail = true;
  assert.equal((await reader.latest()).length, 1);
});
