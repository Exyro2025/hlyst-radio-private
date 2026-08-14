import assert from 'node:assert/strict';
import test from 'node:test';

import {
  headlineNamesLibraryArtist,
  relevantMusicNews,
  safeGeneralHeadline,
} from '../src/skills/news-selection.js';

const items = [
  {
    id: 'metallica', headline: 'Metallica announce an intimate UK show', provider: 'one.test',
    sourceLabel: 'One', url: 'https://one.test/metallica', retrievedAt: '2026-08-14T10:00:00Z',
  },
  {
    id: 'taylor', headline: 'Taylor Swift shares a new video', provider: 'one.test',
    sourceLabel: 'One', url: 'https://one.test/taylor', retrievedAt: '2026-08-14T10:00:00Z',
  },
  {
    id: 'venue', headline: 'Arch Enemy return to The Underworld', provider: 'one.test',
    sourceLabel: 'One', url: 'https://one.test/venue', retrievedAt: '2026-08-14T10:00:00Z',
  },
];

const artists = [
  { name: 'Metallica', genres: ['Heavy Metal', 'Thrash Metal'] },
  { name: 'Taylor Swift', genres: ['Pop'] },
  { name: 'Underworld', genres: ['Electronic'] },
];

test('music news keeps only local artists whose genres fit the show', () => {
  const matches = relevantMusicNews({ items, artists, targetGenres: ['Rock', 'Heavy Metal'] });
  assert.deepEqual(matches.map((item) => item.id), ['metallica']);
});

test('broad station mode may use any unambiguous local artist', () => {
  const matches = relevantMusicNews({ items, artists, targetGenres: [], broad: true });
  assert.deepEqual(matches.map((item) => item.id), ['metallica', 'taylor']);
});

test('one-word artists must open the headline, preventing venue matches', () => {
  assert.equal(headlineNamesLibraryArtist('Underworld announce a new record', 'Underworld'), true);
  assert.equal(headlineNamesLibraryArtist('Arch Enemy return to The Underworld', 'Underworld'), false);
});

test('obviously grave general headlines are rejected before the Persona sees them', () => {
  assert.equal(safeGeneralHeadline('Museum opens a new music exhibition'), true);
  assert.equal(safeGeneralHeadline('Three killed after city centre attack'), false);
});
