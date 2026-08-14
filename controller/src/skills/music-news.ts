// Shared, keyless music-news reader for the v2 skills. Publisher feeds are
// fetched concurrently and cached per source: one broken or withdrawn feed
// cannot disable artist research from the others, and stale successful data
// can bridge a short publisher outage without blocking the live skill path.

import { fetchHeadlines, hashHeadline, type Headline } from './news.js';
import {
  createResearchEvidence,
  unavailableResearchEvidence,
  type ResearchEvidence,
} from './research-evidence.js';

const CACHE_MS = 15 * 60 * 1000;
const FAILURE_CACHE_MS = 5 * 60 * 1000;
const STALE_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3_500;
const ITEMS_PER_FEED = 20;

export interface MusicNewsFeed {
  id: string;
  label: string;
  provider: string;
  url: string;
}

export interface MusicNewsItem {
  id: string;
  headline: string;
  provider: string;
  sourceLabel: string;
  url: string;
  publishedAt?: string;
  retrievedAt: string;
}

export const MUSIC_NEWS_FEEDS: readonly MusicNewsFeed[] = [
  {
    id: 'stereogum',
    label: 'Stereogum',
    provider: 'stereogum.com',
    url: 'https://www.stereogum.com/feed/',
  },
  {
    id: 'pitchfork-news',
    label: 'Pitchfork News',
    provider: 'pitchfork.com',
    url: 'https://pitchfork.com/feed/feed-news/rss',
  },
  {
    id: 'guardian-music',
    label: 'The Guardian Music',
    provider: 'theguardian.com',
    url: 'https://www.theguardian.com/music/rss',
  },
] as const;

interface CachedFeed {
  fetchedAt: number;
  expiresAt: number;
  items: MusicNewsItem[];
}

type FeedFetcher = (feed: MusicNewsFeed) => Promise<Headline[]>;

function normalized(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function headlineMentionsArtist(headline: string, artist: string): boolean {
  const haystack = ` ${normalized(headline)} `;
  const needle = normalized(artist);
  if (!needle || !haystack.includes(` ${needle} `)) return false;
  // A one-word artist name is especially vulnerable to venue/entity
  // collisions. "Arch Enemy at The Underworld" is not an Underworld story.
  // The cautious direction is to reject a match immediately preceded by
  // "the"; multi-word names (including "The Beatles") are unaffected.
  if (!needle.includes(' ') && haystack.includes(` the ${needle} `)) return false;
  return true;
}

function mapFeedItems(feed: MusicNewsFeed, headlines: Headline[], fetchedAt: number): MusicNewsItem[] {
  const retrievedAt = new Date(fetchedAt).toISOString();
  return headlines.flatMap((entry) => {
    const headline = String(entry.title || '').replace(/\s+/g, ' ').trim();
    const url = String(entry.url || '').trim();
    if (!headline || !url) return [];
    return [{
      id: `music-news-${feed.id}-${hashHeadline(`${headline}\u0000${url}`)}`,
      headline,
      provider: feed.provider,
      sourceLabel: feed.label,
      url,
      ...(entry.publishedAt ? { publishedAt: entry.publishedAt } : {}),
      retrievedAt,
    }];
  });
}

function mergeFeeds(entries: CachedFeed[], now: number): MusicNewsItem[] {
  const seen = new Set<string>();
  return entries
    .filter((entry) => now - entry.fetchedAt <= STALE_MS)
    .flatMap((entry) => entry.items)
    .sort((a, b) => {
      const aTime = Date.parse(a.publishedAt || '');
      const bTime = Date.parse(b.publishedAt || '');
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    })
    .filter((item) => {
      const key = normalized(item.headline);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function createMusicNewsReader({
  feeds = MUSIC_NEWS_FEEDS,
  fetchFeed = (feed) => fetchHeadlines({
    feedUrl: feed.url,
    maxItems: ITEMS_PER_FEED,
    timeoutMs: FETCH_TIMEOUT_MS,
  }),
  now = () => Date.now(),
  cacheMs = CACHE_MS,
  failureCacheMs = FAILURE_CACHE_MS,
}: {
  feeds?: readonly MusicNewsFeed[];
  fetchFeed?: FeedFetcher;
  now?: () => number;
  cacheMs?: number;
  failureCacheMs?: number;
} = {}) {
  const cache = new Map<string, CachedFeed>();
  let inFlight: Promise<MusicNewsItem[]> | null = null;

  const latest = async (): Promise<MusicNewsItem[]> => {
    const current = now();
    if (feeds.every((feed) => (cache.get(feed.id)?.expiresAt || 0) > current)) {
      return mergeFeeds([...cache.values()], current);
    }
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const fetchedAt = now();
      const results = await Promise.allSettled(feeds.map(async (feed) => ({
        feed,
        headlines: await fetchFeed(feed),
      })));
      for (let index = 0; index < results.length; index++) {
        const result = results[index];
        const feed = feeds[index];
        if (result.status === 'fulfilled') {
          const { headlines } = result.value;
          cache.set(feed.id, {
            fetchedAt,
            expiresAt: fetchedAt + cacheMs,
            items: mapFeedItems(feed, headlines, fetchedAt),
          });
          continue;
        }
        const previous = cache.get(feed.id);
        cache.set(feed.id, {
          fetchedAt: previous?.fetchedAt ?? fetchedAt,
          expiresAt: fetchedAt + failureCacheMs,
          items: previous?.items ?? [],
        });
      }
      return mergeFeeds([...cache.values()], now());
    })().finally(() => { inFlight = null; });
    return inFlight;
  };

  const forArtist = async (artistValue: string): Promise<ResearchEvidence> => {
    const artist = String(artistValue || '').trim();
    if (!artist) return unavailableResearchEvidence({ artist }, 'artist is required');
    const matches = (await latest()).filter((item) => headlineMentionsArtist(item.headline, artist)).slice(0, 3);
    if (!matches.length) {
      return unavailableResearchEvidence(
        { artist },
        'no cached music-feed headline explicitly names the artist',
      );
    }
    return createResearchEvidence({
      subject: { artist },
      claims: matches.map((item) => ({
        text: item.headline,
        sourceIds: [item.id],
        topic: 'recent-headline',
      })),
      sources: matches.map((item) => ({
        id: item.id,
        provider: item.provider,
        label: `${item.sourceLabel}: ${item.headline}`,
        url: item.url,
        ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
        retrievedAt: item.retrievedAt,
      })),
    });
  };

  return { latest, forArtist };
}

const sharedReader = createMusicNewsReader();

export const fetchMusicNews = () => sharedReader.latest();
export const researchArtistMusicNews = (artist: string) => sharedReader.forArtist(artist);
