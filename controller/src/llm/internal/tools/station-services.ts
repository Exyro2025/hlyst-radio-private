// Station services — the curated facade a skill's data tool (a built-in or an
// operator's custom tool.mjs) gets to look at the world before the DJ speaks.
// This is the SINGLE place segment tools reach into the controller's internals
// (web search, the music library, the queue, feeds, durable recall). It is
// passed as the third argument to every tool fetcher:
//
//   export default async (ctx, state, services) => data
//
// so the contract stays backward-compatible — existing two-arg custom skills
// ignore the third arg and keep working.
//
// The surface is deliberately READ-MOSTLY: search, library reads, play-log
// reads, a durable dedup store, and a log line. No writes to settings, no
// secrets, no queue mutation — a custom tool.mjs running here is the operator's
// own code (same trust model as a local Claude Code skill), fenced by the 8s
// timeout at the call site, but it still shouldn't be handed the whole booth.

import { queue } from '../../../broadcast/queue.js';
import { searchWeb, searchReady } from '../../../skills/web-search.js';
import {
  fetchOnThisDay,
  curiositySeen,
  recordCuriosity,
  researchOnThisDay,
} from '../../../skills/curiosity.js';
import { fetchHeadlines, hashHeadline } from '../../../skills/news.js';
import { getArtist, getAlbum, searchArtists } from '../../../music/subsonic.js';
import { artistGenreProfiles, get as getLibraryTrack } from '../../../music/library.js';
import { relevantMusicNews, safeGeneralHeadline } from '../../../skills/news-selection.js';
import { researchExactTrack } from '../../../skills/track-research.js';
import { fetchMusicNews, researchArtistMusicNews } from '../../../skills/music-news.js';
import { researchAlbumAnniversary } from '../../../skills/album-anniversary.js';
import { researchWeatherOutlook } from '../../../skills/weather-outlook.js';

interface NewsRelevanceContext {
  activeShow?: { genres?: string[] | null } | null;
}

export interface StationServices {
  // Web search via the operator's configured provider (DuckDuckGo / Tavily /
  // SearXNG). `searchReady()` is false when no provider is usable.
  searchWeb: typeof searchWeb;
  searchReady: typeof searchReady;
  // Provenance-bearing exact-track facts from specialist music data sources.
  researchTrack: typeof researchExactTrack;
  // Cached keyless music headlines and exact-artist evidence for v2 skills.
  fetchMusicNews: typeof fetchMusicNews;
  researchArtistNews: typeof researchArtistMusicNews;
  researchAlbumAnniversary: typeof researchAlbumAnniversary;
  researchWeatherOutlook: typeof researchWeatherOutlook;
  researchCuriosity: typeof researchOnThisDay;
  // The track currently on air (artist/title/album/year/id), or null.
  nowPlaying: () => any | null;
  // Play-log lookup over the last `hours` — { ids, keys } sets for dedup.
  recentPlays: (hours: number) => { ids: Set<string>; keys: Set<string> };
  // Subsonic/Navidrome library reads.
  library: {
    getArtist: typeof getArtist;
    getAlbum: typeof getAlbum;
    searchArtists: typeof searchArtists;
    artistGenreProfiles: typeof artistGenreProfiles;
  };
  // Apply News v2's local-library/show-genre editorial gate.
  relevantMusicNews: (
    items: Awaited<ReturnType<typeof fetchMusicNews>>,
    ctx: NewsRelevanceContext,
  ) => ReturnType<typeof relevantMusicNews>;
  safeGeneralHeadline: typeof safeGeneralHeadline;
  // Wikipedia "on this day" events for today's date.
  onThisDay: () => Promise<any[]>;
  // Fetch + parse an RSS feed (defaults to the configured news feed).
  fetchHeadlines: typeof fetchHeadlines;
  hashHeadline: typeof hashHeadline;
  // Durable, cross-restart dedup ledger — remember what was aired so it isn't
  // repeated days later. (Backs the curiosity skill; available to any skill.)
  recall: { seen: (key: string) => boolean; remember: (key: string) => void };
  // Append a namespaced line to the station event log.
  log: (msg: string) => void;
}

// Rehearsals share live read paths but cannot consume durable evidence or add
// tool-authored booth lines. Curiosity v2 has its own source adapter, so its
// burn-on-read behaviour is explicitly disabled here as well.
export function rehearsalStationServices(services: StationServices): StationServices {
  return {
    ...services,
    researchCuriosity: (date, options) => services.researchCuriosity(
      date,
      { ...options, remember: false },
    ),
    recall: { ...services.recall, remember: () => {} },
    log: () => {},
  };
}

let cached: StationServices | null = null;

// Build (once) the services facade. The wrappers are stateless — `nowPlaying`,
// `recentPlays` etc. read live from the queue each call — so a single cached
// instance is safe to reuse across ticks.
export function buildStationServices(): StationServices {
  if (cached) return cached;
  cached = {
    searchWeb,
    searchReady,
    researchTrack: researchExactTrack,
    fetchMusicNews,
    researchArtistNews: researchArtistMusicNews,
    researchAlbumAnniversary,
    researchWeatherOutlook,
    researchCuriosity: researchOnThisDay,
    nowPlaying: () => queue.current?.track ?? null,
    recentPlays: (hours: number) => queue.recentlyPlayed(hours),
    library: { getArtist, getAlbum, searchArtists, artistGenreProfiles },
    relevantMusicNews: (items, ctx) => {
      const showGenres = Array.isArray(ctx?.activeShow?.genres) ? ctx.activeShow.genres.filter(Boolean) : [];
      const current = queue.current?.track;
      const currentGenres = current?.id ? (getLibraryTrack(current.id)?.genres || []) : [];
      return relevantMusicNews({
        items,
        artists: artistGenreProfiles(),
        targetGenres: showGenres.length ? showGenres : currentGenres,
        // Autonomous/no-show listening is the broad station mode. A defined
        // show without genres uses the current track's genres as a soft gate.
        broad: !ctx?.activeShow || (!showGenres.length && !currentGenres.length),
      });
    },
    safeGeneralHeadline,
    onThisDay: () => fetchOnThisDay(),
    fetchHeadlines,
    hashHeadline,
    recall: { seen: (key: string) => curiositySeen(key), remember: (key: string) => recordCuriosity(key) },
    log: (msg: string) => queue.log('scheduler', `[skill] ${msg}`),
  };
  return cached;
}
