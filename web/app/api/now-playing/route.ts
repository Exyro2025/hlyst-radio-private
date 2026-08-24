// Same-origin /api/now-playing — the player finds this automatically since
// stationOrigin.ts defaults apiUrl to '/api'. No env var changes needed for
// this to be picked up.
//
// Place this file at: web/app/api/now-playing/route.ts
//
// Honest about what Live365 can and can't provide: streamOnline reflects
// whether a real Live365 stream URL is configured; nowPlaying/dj/activeShow
// stay null until either Live365's metadata is confirmed reachable, or the
// real HLYST controller takes over (see NEXT_PUBLIC_API_URL later).

import { NextResponse } from 'next/server';
import type { NowPlayingResponse } from '@/lib/types';

export async function GET() {
  const streamConfigured = !!process.env.NEXT_PUBLIC_STREAM_URL;

  const payload: NowPlayingResponse = {
    nowPlaying: null, // Live365 metadata not yet confirmed reachable — see stationOrigin/live365 notes
    context: null,
    dj: undefined,
    activeShow: null,
    listeners: undefined,
    streamOnline: streamConfigured,
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
