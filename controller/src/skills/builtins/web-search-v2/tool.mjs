// Recent artist updates restricted to established music/event publications.
// Only matching headlines cross the tool boundary; adjacent snippets are never
// presented as facts for the speaking model to combine.
const TRUSTED_DOMAINS = [
  'nme.com',
  'stereogum.com',
  'pitchfork.com',
  'musicweek.com',
  'songkick.com',
  'bandsintown.com',
  'setlist.fm',
];

export const description = 'Find a recent, artist-specific headline from a trusted music or live-event source. Use only an explicit returned headline; unavailable means stay silent.';

// The shared RSS reader is keyless, so this remains usable when no general
// web-search provider is configured. Search is only the fallback.
export const ready = () => true;

function normalized(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function mentionsArtist(value, artist) {
  const haystack = ` ${normalized(value)} `;
  const needle = normalized(artist);
  if (!needle || !haystack.includes(` ${needle} `)) return false;
  if (!needle.includes(' ') && haystack.includes(` the ${needle} `)) return false;
  return true;
}

function trustedHost(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLocaleLowerCase('en').replace(/^www\./, '');
    return TRUSTED_DOMAINS.find((domain) => host === domain || host.endsWith(`.${domain}`)) || null;
  } catch {
    return null;
  }
}

export function trustedArtistHeadlineEvidence(artist, results) {
  const matches = (results || []).flatMap((result, index) => {
    const host = trustedHost(result.url);
    const headline = String(result.title || '').replace(/\s+/g, ' ').trim();
    if (!host || !headline || !mentionsArtist(headline, artist)) return [];
    const id = `artist-news-${index + 1}`;
    return [{
      id,
      headline,
      source: {
        id,
        provider: host,
        label: headline,
        url: String(result.url),
        ...(result.publishedAt ? { retrievedAt: String(result.publishedAt) } : {}),
      },
    }];
  }).slice(0, 3);
  if (!matches.length) {
    return { available: false, artist, reason: 'no recent trusted-source headline named the artist' };
  }
  return {
    format: 'subwave.research-evidence.v1',
    available: true,
    subject: { artist },
    claims: matches.map((match) => ({
      text: match.headline,
      sourceIds: [match.id],
      topic: 'recent-headline',
    })),
    sources: matches.map((match) => match.source),
  };
}

export default async function searchArtistNews(ctx, state, services) {
  const artist = String(services.nowPlaying()?.artist || '').trim();
  if (!artist || /^unknown/i.test(artist)) {
    return { available: false, reason: 'the current track has no usable artist identity' };
  }
  const feedEvidence = await services.researchArtistNews(artist);
  if (feedEvidence?.available) return feedEvidence;
  if (!services.searchReady()) return feedEvidence;

  const sites = TRUSTED_DOMAINS.map((domain) => `site:${domain}`).join(' OR ');
  const data = await services.searchWeb(`"${artist}" (${sites})`, { recency: 'week' });
  return trustedArtistHeadlineEvidence(artist, data.results);
}
