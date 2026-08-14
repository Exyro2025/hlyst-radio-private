import assert from 'node:assert/strict';
import test from 'node:test';

const toolUrl = new URL('../src/skills/builtins/web-search-v2/tool.mjs', import.meta.url);
const { default: runTool, ready, trustedArtistHeadlineEvidence } = await import(toolUrl.href);

test('artist news remains ready without a configured search provider', () => {
  assert.equal(ready({ searchReady: () => false }), true);
});

test('artist news uses cached RSS evidence before general web search', async () => {
  let searches = 0;
  const evidence = await runTool({}, {}, {
    nowPlaying: () => ({ artist: 'Underworld' }),
    researchArtistNews: async () => ({
      format: 'subwave.research-evidence.v1',
      available: true,
      subject: { artist: 'Underworld' },
      claims: [{ text: 'Underworld announce a new live record', sourceIds: ['rss-1'] }],
      sources: [{ id: 'rss-1', provider: 'stereogum.com', label: 'Stereogum' }],
    }),
    searchReady: () => true,
    searchWeb: async () => { searches++; return { results: [] }; },
  });
  assert.equal(evidence.available, true);
  assert.equal(searches, 0);
});

test('artist news falls back to configured search when RSS has no match', async () => {
  let searches = 0;
  const evidence = await runTool({}, {}, {
    nowPlaying: () => ({ artist: 'Underworld' }),
    researchArtistNews: async () => ({
      format: 'subwave.research-evidence.v1',
      available: false,
      subject: { artist: 'Underworld' },
      reason: 'no claim has valid provenance',
    }),
    searchReady: () => true,
    searchWeb: async () => {
      searches++;
      return { results: [{
        title: 'Underworld announce a new live record',
        url: 'https://www.nme.com/news/music/underworld-live-record-123',
      }] };
    },
  });
  assert.equal(evidence.available, true);
  assert.equal(searches, 1);
});

test('artist news accepts only a trusted URL whose headline names the artist', () => {
  const evidence = trustedArtistHeadlineEvidence('Public Service Broadcasting', [
    {
      title: 'Public Service Broadcasting announce a new UK tour',
      content: 'unused adjacent snippet',
      url: 'https://www.nme.com/news/music/public-service-broadcasting-tour-123',
    },
    {
      title: 'Public Service Broadcasting announce something implausible',
      content: 'spoof',
      url: 'https://nme.com.example.test/fake',
    },
    {
      title: 'Another band announces a tour',
      content: 'Public Service Broadcasting appears only in the snippet',
      url: 'https://pitchfork.com/news/another-band-tour',
    },
  ]);
  assert.equal(evidence.available, true);
  assert.equal(evidence.claims.length, 1);
  assert.match(evidence.claims[0].text, /Public Service Broadcasting/);
  assert.equal(evidence.sources[0].provider, 'nme.com');
});

test('artist news stays unavailable when no trusted headline matches', () => {
  const evidence = trustedArtistHeadlineEvidence('Limp Bizkit', [{
    title: 'Former members of several bands discuss the 1990s',
    content: 'Limp Bizkit appears only in this snippet',
    url: 'https://example.test/music/story',
  }]);
  assert.equal(evidence.available, false);
});

test('artist news rejects a venue collision for a one-word artist', () => {
  const evidence = trustedArtistHeadlineEvidence('Underworld', [{
    title: 'Arch Enemy return to The Underworld in London',
    url: 'https://www.nme.com/news/music/arch-enemy-underworld-123',
  }]);
  assert.equal(evidence.available, false);
});
