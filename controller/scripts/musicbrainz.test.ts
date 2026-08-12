import assert from 'node:assert/strict';
import test from 'node:test';

import { exactMusicBrainzRecording, musicBrainzEvidenceFromResponses } from '../src/skills/musicbrainz.js';

const exact = {
  id: 'recording-id',
  title: 'Disturbing the Priest',
  'first-release-date': '1983-08-07',
  'artist-credit': [{ artist: { name: 'Black Sabbath' } }],
};

test('MusicBrainz matching requires the exact recording title and credited artist', () => {
  assert.equal(exactMusicBrainzRecording([
    { ...exact, id: 'recent-reissue', 'first-release-date': '2025-03' },
    { ...exact, id: 'wrong-artist', 'artist-credit': [{ artist: { name: 'Tribute Band' } }] },
    { ...exact, id: 'wrong-version', title: 'Disturbing the Priest (Live)' },
    exact,
  ], 'Black Sabbath', 'Disturbing the Priest')?.id, 'recording-id');
  assert.equal(exactMusicBrainzRecording([exact], 'Ozzy Osbourne', 'Disturbing the Priest'), null);
});

test('MusicBrainz creates sourced release and producer claims', () => {
  const evidence = musicBrainzEvidenceFromResponses({
    artist: 'Black Sabbath',
    title: 'Disturbing the Priest',
    search: { recordings: [exact] },
    lookup: {
      relations: [
        { type: 'producer', artist: { name: 'Robin Black' } },
        { type: 'producer', artist: { name: 'Black Sabbath' } },
        { type: 'mix', artist: { name: 'Unrelated Engineer' } },
      ],
    },
    retrievedAt: '2026-08-12T12:00:00.000Z',
  });
  assert.equal(evidence.available, true);
  if (!evidence.available) return;
  assert.deepEqual(evidence.claims.map((claim) => claim.topic), ['first-release', 'production-credit']);
  assert.match(evidence.claims[1].text, /Robin Black and Black Sabbath/);
  assert.equal(evidence.sources[0].provider, 'musicbrainz');
  assert.equal(evidence.sources[0].retrievedAt, '2026-08-12T12:00:00.000Z');
});

test('MusicBrainz remains silent when the response has no exact match', () => {
  const evidence = musicBrainzEvidenceFromResponses({
    artist: 'Happy Mondays',
    title: 'Angel',
    search: { recordings: [{ ...exact, title: 'Angel' }] },
    lookup: {},
  });
  assert.equal(evidence.available, false);
});
