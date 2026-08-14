import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createResearchEvidence,
  RESEARCH_EVIDENCE_FORMAT,
} from '../src/skills/research-evidence.js';

test('a valid evidence packet retains claim provenance', () => {
  const evidence = createResearchEvidence({
    subject: { artist: 'Black Sabbath', title: 'Disturbing the Priest' },
    claims: [{
      text: '“Disturbing the Priest” was produced by Robin Black and Black Sabbath.',
      sourceIds: ['musicbrainz-recording'],
      topic: 'production-credit',
    }],
    sources: [{
      id: 'musicbrainz-recording',
      provider: 'musicbrainz',
      label: 'MusicBrainz recording relationships',
      url: 'https://musicbrainz.org/recording/example',
      publishedAt: '1983-01-01T00:00:00.000Z',
    }],
  });
  assert.equal(evidence.format, RESEARCH_EVIDENCE_FORMAT);
  assert.equal(evidence.available, true);
  if (!evidence.available) return;
  assert.equal(evidence.claims[0].sourceIds[0], evidence.sources[0].id);
  assert.equal(evidence.sources[0].publishedAt, '1983-01-01T00:00:00.000Z');
});

test('claims without a matching source become unavailable', () => {
  const evidence = createResearchEvidence({
    subject: { artist: 'Happy Mondays', title: 'Angel' },
    claims: [{ text: 'An unsupported B-side claim.', sourceIds: ['missing'] }],
    sources: [],
  });
  assert.equal(evidence.available, false);
});

test('source-neutral evidence may identify a topic without inventing an artist', () => {
  const evidence = createResearchEvidence({
    subject: { topic: 'general-news' },
    claims: [{ text: 'A museum has opened a new exhibition.', sourceIds: ['news-1'] }],
    sources: [{ id: 'news-1', provider: 'bbc.co.uk', label: 'BBC News' }],
  });
  assert.equal(evidence.available, true);
  assert.deepEqual(evidence.subject, { topic: 'general-news' });
});
