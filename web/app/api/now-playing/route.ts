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

import { NextResponse } from 'next/server';
import type { NowPlayingResponse } from '@/lib/types';
import { broadcastProvider } from '@/lib/broadcastProvider';

export async function GET() {
  const status = await broadcastProvider.getStatus();

  const payload: NowPlayingResponse = {
    nowPlaying: status.artist && status.title
      ? { artist: status.artist, title: status.title }
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
      bufferSeconds: 22,
    },
    llmTokens: null,
    timezone: 'America/New_York',
    locale: 'en-US',
  };

  return NextResponse.json(payload);
}
