import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exactResearchRecording,
  recordingResearchFromResponses,
  type MbRecording,
} from '../src/music/musicbrainz.js';
import { trackResearchClaims } from '../src/skills/track-research.js';

const exact: MbRecording = {
  id: 'recording-id',
  score: 100,
  title: 'Disturbing the Priest',
  'first-release-date': '1983-08-07',
  'artist-credit': [{ artist: { name: 'Black Sabbath' } }],
};

test('specialist research requires an exact title and credited artist', () => {
  assert.equal(exactResearchRecording([
    { ...exact, id: 'recent-reissue', 'first-release-date': '2025-03' },
    { ...exact, id: 'wrong-artist', 'artist-credit': [{ artist: { name: 'Tribute Band' } }] },
    { ...exact, id: 'wrong-version', title: 'Disturbing the Priest (Live)' },
    exact,
  ], 'Black Sabbath', 'Disturbing the Priest')?.id, 'recording-id');
  assert.equal(exactResearchRecording([exact], 'Ozzy Osbourne', 'Disturbing the Priest'), null);
});

test('specialist research extracts only supported explicit artist relationships', () => {
  const result = recordingResearchFromResponses([exact], {
    relations: [
      { type: 'producer', artist: { name: 'Robin Black' } },
      { type: 'producer', artist: { name: 'Black Sabbath' } },
      { type: 'mix', artist: { name: 'Ian Cooper' } },
      { type: 'remixer', artist: { name: 'The Beatmasters' } },
      { type: 'engineer', artist: { name: 'Unsupported Generic Credit' } },
    ],
  }, 'Black Sabbath', 'Disturbing the Priest');
  assert.deepEqual(result?.producers, ['Robin Black', 'Black Sabbath']);
  assert.deepEqual(result?.mixers, ['Ian Cooper']);
  assert.deepEqual(result?.remixers, ['The Beatmasters']);
  assert.equal(result?.firstReleaseDate, '1983-08-07');
});

test('specialist research turns every supported credit into a provenance-bound claim', () => {
  const claims = trackResearchClaims(
    { artist: 'Black Sabbath', title: 'Disturbing the Priest' },
    'musicbrainz-recording-recording-id',
    {
      id: 'recording-id',
      title: 'Disturbing the Priest',
      artists: ['Black Sabbath'],
      firstReleaseDate: '1983-08-07',
      producers: ['Robin Black', 'Black Sabbath'],
      mixers: ['Ian Cooper'],
      remixers: ['The Beatmasters'],
    },
  );
  assert.deepEqual(claims.map((claim) => claim.topic), [
    'first-release',
    'production-credit',
    'mixing-credit',
    'remixing-credit',
  ]);
  assert.ok(claims.every((claim) => claim.sourceIds[0] === 'musicbrainz-recording-recording-id'));
});
