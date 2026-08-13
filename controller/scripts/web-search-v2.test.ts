import assert from 'node:assert/strict';
import test from 'node:test';

const toolUrl = new URL('../src/skills/builtins/web-search-v2/tool.mjs', import.meta.url);
const { trustedArtistHeadlineEvidence } = await import(toolUrl.href);

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
