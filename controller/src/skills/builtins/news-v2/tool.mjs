export const description = 'Choose one provenance-bearing general or show-relevant music headline. Use only the returned claim; unavailable means stay silent.';

export const ready = () => true;

function sourceHost(rawUrl) {
  try { return new URL(rawUrl).hostname.toLocaleLowerCase('en').replace(/^www\./, ''); }
  catch { return 'rss'; }
}

function unavailable(reason) {
  return {
    format: 'subwave.research-evidence.v1',
    available: false,
    subject: { topic: 'news' },
    reason,
  };
}

function seen(state, services, id) {
  if (!(state.newsV2Seen instanceof Set)) state.newsV2Seen = new Set();
  return state.newsV2Seen.has(id) || services.recall.seen(`news-v2:${id}`);
}

function remember(state, services, id) {
  state.newsV2Seen.add(id);
  services.recall.remember(`news-v2:${id}`);
  if (state.newsV2Seen.size > 120) {
    state.newsV2Seen = new Set(Array.from(state.newsV2Seen).slice(-60));
  }
}

function generalCandidates(items, state, services) {
  return (items || []).flatMap((item) => {
    const headline = String(item.title || '').replace(/\s+/g, ' ').trim();
    const url = String(item.url || '').trim();
    if (!headline || !url || !services.safeGeneralHeadline(headline)) return [];
    const id = `general-news-${services.hashHeadline(`${headline}\u0000${url}`)}`;
    return seen(state, services, id) ? [] : [{
      id,
      headline,
      provider: sourceHost(url),
      sourceLabel: 'General news',
      url,
      publishedAt: item.publishedAt || null,
      topic: 'general-news',
    }];
  });
}

function musicCandidates(items, state, services) {
  return (items || []).filter((item) => !seen(state, services, item.id)).map((item) => ({
    ...item,
    topic: 'music-news',
  }));
}

export default async function getNews(ctx, state, services) {
  const [musicResult, generalResult] = await Promise.allSettled([
    services.fetchMusicNews(),
    services.fetchHeadlines({ maxItems: 12, timeoutMs: 3_500 }),
  ]);

  let musicItems = [];
  if (musicResult.status === 'fulfilled') {
    try {
      musicItems = musicCandidates(services.relevantMusicNews(musicResult.value, ctx), state, services);
    } catch {
      // A library/index problem must not suppress the independent general feed.
      musicItems = [];
    }
  }
  const generalItems = generalResult.status === 'fulfilled'
    ? generalCandidates(generalResult.value, state, services)
    : [];

  const preferred = state.newsV2Next === 'general' ? 'general' : 'music';
  const item = preferred === 'music'
    ? (musicItems[0] || generalItems[0])
    : (generalItems[0] || musicItems[0]);
  if (!item) return unavailable('no unseen, suitable general or show-relevant music headline');

  remember(state, services, item.id);
  state.newsV2Next = item.topic === 'music-news' ? 'general' : 'music';
  return {
    format: 'subwave.research-evidence.v1',
    available: true,
    subject: {
      topic: item.topic,
      ...(item.artist ? { artist: item.artist } : {}),
    },
    claims: [{ text: item.headline, sourceIds: [item.id], topic: item.topic }],
    sources: [{
      id: item.id,
      provider: item.provider,
      label: `${item.sourceLabel}: ${item.headline}`,
      url: item.url,
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      ...(item.retrievedAt ? { retrievedAt: item.retrievedAt } : {}),
    }],
  };
}
