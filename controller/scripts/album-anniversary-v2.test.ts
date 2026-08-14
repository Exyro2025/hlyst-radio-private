import assert from 'node:assert/strict';
import test from 'node:test';

import { albumAnniversaryClaim } from '../src/skills/album-anniversary.js';

const album = (overrides = {}) => ({
  id: 'album-1',
  name: 'Songs from a Room',
  artist: 'Leonard Cohen',
  year: 2019,
  originalReleaseDate: { year: 1969 },
  releaseTypes: ['Album'],
  isCompilation: false,
  ...overrides,
});

test('uses the original release date rather than a reissue year', () => {
  const claim = albumAnniversaryClaim(album(), 2029);
  assert.equal(claim?.releasedYear, 1969);
  assert.equal(claim?.years, 60);
  assert.match(claim?.text || '', /originally released in 1969/);
});

test('rejects compilations and non-album release types', () => {
  assert.equal(albumAnniversaryClaim(album({ isCompilation: true }), 2029), null);
  for (const releaseTypes of [['Compilation'], ['Single'], ['EP'], ['Remix Album'], ['Mixtape']]) {
    assert.equal(albumAnniversaryClaim(album({ releaseTypes }), 2029), null, String(releaseTypes));
  }
});

test('requires explicit album type and original release metadata', () => {
  assert.equal(albumAnniversaryClaim(album({ releaseTypes: [] }), 2029), null);
  assert.equal(albumAnniversaryClaim(album({ originalReleaseDate: null }), 2029), null);
});

test('only accepts five-year anniversaries', () => {
  assert.equal(albumAnniversaryClaim(album(), 2028), null);
  assert.equal(albumAnniversaryClaim(album(), 1973), null);
});
