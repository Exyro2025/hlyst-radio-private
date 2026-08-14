// Deterministic editorial selection for News v2. The model receives an
// already-approved headline; it never guesses which publisher item belongs in
// a show or whether a named phrase is an artist in this station's library.

import { genreMatches, normGenre } from '../music/show-filter.js';
import type { ArtistGenreProfile } from '../music/library-db/browse.js';
import type { MusicNewsItem } from './music-news.js';

function normalized(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Multi-word names may appear anywhere as a complete phrase. One-word names
// are accepted only at the start of a headline: this intentionally sacrifices
// recall to prevent common words and venues (Live, Air, The Underworld) from
// becoming false artist identities.
export function headlineNamesLibraryArtist(headline: string, artist: string): boolean {
  const text = normalized(headline);
  const name = normalized(artist);
  if (!text || !name) return false;
  if (!name.includes(' ')) return text === name || text.startsWith(`${name} `);
  return (` ${text} `).includes(` ${name} `);
}

export interface RelevantMusicNews extends MusicNewsItem {
  artist: string;
  artistGenres: string[];
}

export function relevantMusicNews({
  items,
  artists,
  targetGenres,
  broad = false,
}: {
  items: MusicNewsItem[];
  artists: ArtistGenreProfile[];
  targetGenres: string[];
  broad?: boolean;
}): RelevantMusicNews[] {
  const targetNorms = targetGenres.map(normGenre).filter(Boolean);
  const byFirstToken = new Map<string, Array<ArtistGenreProfile & { normalizedName: string }>>();
  for (const artist of artists) {
    const normalizedName = normalized(artist.name);
    if (!normalizedName || !artist.genres.length) continue;
    const first = normalizedName.split(' ')[0];
    const bucket = byFirstToken.get(first) || [];
    bucket.push({ ...artist, normalizedName });
    byFirstToken.set(first, bucket);
  }
  for (const bucket of byFirstToken.values()) {
    bucket.sort((a, b) => b.normalizedName.length - a.normalizedName.length);
  }

  return items.flatMap((item) => {
    const headline = normalized(item.headline);
    const tokens = [...new Set(headline.split(' ').filter(Boolean))];
    const candidates = tokens.flatMap((token) => byFirstToken.get(token) || []);
    const artist = candidates.find((candidate) => {
      const namesArtist = candidate.normalizedName.includes(' ')
        ? (` ${headline} `).includes(` ${candidate.normalizedName} `)
        : headline === candidate.normalizedName || headline.startsWith(`${candidate.normalizedName} `);
      return namesArtist && (broad || genreMatches({ genres: candidate.genres }, targetNorms));
    });
    return artist ? [{ ...item, artist: artist.name, artistGenres: artist.genres }] : [];
  });
}

const HARD_NEWS_TOPICS = /\b(?:killed?|dead|dies?|death|murder|war|invasion|bomb(?:ing)?|attack|shooting|earthquake|flood|wildfire|disaster|crash|abuse|rape|hostage|famine)\b/i;

export function safeGeneralHeadline(title: string): boolean {
  const text = String(title || '').trim();
  return !!text && !HARD_NEWS_TOPICS.test(text);
}
