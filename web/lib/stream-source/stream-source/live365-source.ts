// Live365 implementation of StreamSource.
//
// IMPORTANT: Live365 does not currently offer a confirmed public API for
// Now Playing metadata (a broadcaster feature request for one has been open
// since 2019). This file is written with a placeholder metadata fetch that
// you'll need to confirm against your actual Live365 broadcaster dashboard.
//
// What's SAFE to fill in right now:
//   - LIVE365_STREAM_URL: your direct stream URL, found in your Live365
//     broadcaster dashboard under stream/server details. This part works
//     regardless of the metadata question.
//
// What needs verification:
//   - Whether your specific Live365 station exposes a status/now-playing
//     endpoint (common on Icecast-compatible streams, not guaranteed).
//     Check your Live365 dashboard's "embed" or "widget" section — if they
//     give you a JS snippet, view its network requests in your browser's
//     dev tools to find the URL it calls for Now Playing data, then plug
//     that URL into fetchLive365Metadata below.
//
// Until that's confirmed, this returns safe fallback data (stream plays,
// but title/artist show as "HLYST Radio" generically) rather than crashing.
//
// Place this file at: web/lib/stream-source/live365-source.ts

import type { StreamSource, StreamSourceData } from './types';

const LIVE365_STREAM_URL = process.env.LIVE365_STREAM_URL || '';
// Fill in once confirmed — see comment above.
const LIVE365_METADATA_URL = process.env.LIVE365_METADATA_URL || '';

async function fetchLive365Metadata(): Promise<Partial<StreamSourceData>> {
  if (!LIVE365_METADATA_URL) return {};
  try {
    const res = await fetch(LIVE365_METADATA_URL, { next: { revalidate: 10 } });
    if (!res.ok) return {};
    const data = await res.json();
    // NOTE: field names below are GUESSES until you confirm the real
    // response shape from your Live365 dashboard's network tab. Adjust to
    // match whatever the real payload actually contains.
    return {
      track: data?.title
        ? { title: data.title, artist: data.artist ?? null, artwork: data.artwork ?? null }
        : null,
      listeners: data?.listeners ?? null,
    };
  } catch {
    return {};
  }
}

export class Live365Source implements StreamSource {
  async getCurrentState(): Promise<StreamSourceData> {
    const meta = await fetchLive365Metadata();
    return {
      isLive: true,
      streamUrl: LIVE365_STREAM_URL,
      currentDj: null,       // Live365 doesn't carry HLYST persona identity
      currentShow: null,     // same — this is HLYST-specific, fills in later
      track: meta.track ?? null,
      listeners: meta.listeners ?? null,
    };
  }
}
