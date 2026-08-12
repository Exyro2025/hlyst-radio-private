import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createResearchEvidence,
  personaResearchEvidence,
  RESEARCH_EVIDENCE_FORMAT,
} from '../src/skills/research-evidence.js';

test('a valid evidence packet retains claim provenance', () => {
  assert.deepEqual(createResearchEvidence({
    subject: { artist: 'Black Sabbath', title: 'Disturbing the Priest' },
    claims: [{
      text: '“Disturbing the Priest” was produced by Robin Black and Black Sabbath.',
      sourceIds: ['musicbrainz-work'],
      topic: 'production-credit',
    }],
    sources: [{
      id: 'musicbrainz-work',
      provider: 'musicbrainz',
      label: 'MusicBrainz recording relationships',
      url: 'https://musicbrainz.org/recording/example',
    }],
  }), {
    format: RESEARCH_EVIDENCE_FORMAT,
    available: true,
    subject: { artist: 'Black Sabbath', title: 'Disturbing the Priest' },
    claims: [{
      text: '“Disturbing the Priest” was produced by Robin Black and Black Sabbath.',
      sourceIds: ['musicbrainz-work'],
      topic: 'production-credit',
    }],
    sources: [{
      id: 'musicbrainz-work',
      provider: 'musicbrainz',
      label: 'MusicBrainz recording relationships',
      url: 'https://musicbrainz.org/recording/example',
    }],
  });
});

test('claims without a matching source become unavailable', () => {
  const evidence = createResearchEvidence({
    subject: { artist: 'Happy Mondays', title: 'Angel' },
    claims: [{ text: 'An unsupported B-side claim.', sourceIds: ['missing'] }],
    sources: [],
  });
  assert.equal(evidence.available, false);
  assert.equal(evidence.format, RESEARCH_EVIDENCE_FORMAT);
});

test('Persona receives approved facts but no provenance mechanics', () => {
  const evidence = createResearchEvidence({
    subject: { artist: 'Anna Meredith', title: 'Dowager' },
    claims: [{ text: 'The track begins like a spinster lament.', sourceIds: ['review'] }],
    sources: [{
      id: 'review',
      provider: 'trusted-feed',
      label: 'A cited review excerpt',
      url: 'https://example.test/private-research-url',
    }],
  });
  const persona = personaResearchEvidence(evidence);
  assert.deepEqual(persona, {
    subject: { artist: 'Anna Meredith', title: 'Dowager' },
    facts: ['The track begins like a spinster lament.'],
  });
  assert.ok(!JSON.stringify(persona).includes('trusted-feed'));
  assert.ok(!JSON.stringify(persona).includes('example.test'));
});
