// Same-origin /api/now-playing — the player finds this automatically since
// stationOrigin.ts defaults apiUrl to '/api'. No env var changes needed for
// this to be picked up.
//
// Place this file at: web/app/api/now-playing/route.ts
//
// Reads through broadcastProvider.ts rather than talking to Live365 (or
// hardcoding streamConfigured) directly — see that file's header for why
// nowPlaying/dj/activeShow stay honestly null even once Live365 is
// configured. streamOnline now reflects the provider's real configState
// instead of a separate env-var check that could drift out of sync with it.
//
// artworkUrl/isNewRelease are HLYST-specific additions, kept local to this
// route (not added to the shared NowPlayingTrack type in lib/types.ts) —
// when a real track is playing, this does a best-effort lookup against the
// artist_music table by title+artist to attach real artwork (never a
// fabricated cover) and the real NEW_RELEASE status, matching the "Title +
// Artist always visible, artwork optional, no fake covers" requirement.
// The lookup is deliberately best-effort: if it fails or finds nothing,
// nowPlaying still returns with just title/artist — a missing artwork/
// release-status match is never a reason to break the whole response.

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import type { NowPlayingResponse } from '@/lib/types';
import { broadcastProvider } from '@/lib/broadcastProvider';

// Forces dynamic rendering — this route hits the DB at module load
// (const sql = neon(...)) and must never be statically evaluated at
// Docker build time, when TALKWAVE_URL_POSTGRES_URL isn't set.
export const dynamic = 'force-dynamic';


const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

interface HlystNowPlayingExtras {
  artworkUrl?: string;
  isNewRelease?: boolean;
}

async function lookupArtistMusicExtras(artist: string, title: string): Promise<HlystNowPlayingExtras> {
  try {
    const rows = await sql`
      SELECT artwork_url, release_status FROM artist_music
      WHERE lower(artist) = lower(${artist}) AND lower(title) = lower(${title})
      LIMIT 1
    `;
    if (!rows.length) return {};
    const r = rows[0] as any;
    return {
      artworkUrl: r.artwork_url ?? undefined,
      isNewRelease: r.release_status === 'NEW_RELEASE',
    };
  } catch {
    return {};
  }
}

export async function GET() {
  const status = await broadcastProvider.getStatus();

  const extras = status.artist && status.title
    ? await lookupArtistMusicExtras(status.artist, status.title)
    : {};

  const payload: NowPlayingResponse & { nowPlaying: (NowPlayingResponse['nowPlaying'] & HlystNowPlayingExtras) | null } = {
    nowPlaying: status.artist && status.title
      ? { artist: status.artist, title: status.title, ...extras }
      : null,
    context: null,
    dj: {
      name: status.currentDj || 'HLYST',
      tagline: 'The lyst that never gets old.',
      avatar: '',
      station: 'HLYST',
    },
    activeShow: status.currentShow ? { name: status.currentShow } : null,
    listeners: undefined,
    streamOnline: status.connected,
    streamBitrate: null,
    stream: {
      mount: '/stream.mp3',
      format: 'mp3',
      bitrate: null,
      sampleRate: null,
      channels: null,
      opusEnabled: false,
      flacEnabled: false,
      aacEnabled: false,
      bufferSeconds: 22, // matches the controller's own default fallback
    },
    llmTokens: null,
    timezone: 'America/New_York', // HLYST is Cleveland-rooted — adjust if needed
    locale: 'en-US',
  };

  return NextResponse.json(payload);
}
