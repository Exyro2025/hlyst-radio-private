// Future implementation — calls the HLYST controller's own /now-playing
// endpoint once the controller host exists (see DEPLOY.md). Written now so
// the switch-over later is a one-line env var change, not a rebuild.
//
// Place this file at: web/lib/stream-source/hlyst-controller-source.ts

import type { StreamSource, StreamSourceData } from './types';

const CONTROLLER_API_URL = process.env.HLYST_CONTROLLER_URL || '';

export class HlystControllerSource implements StreamSource {
  async getCurrentState(): Promise<StreamSourceData> {
    const res = await fetch(`${CONTROLLER_API_URL}/api/now-playing`, {
      next: { revalidate: 5 },
    });
    if (!res.ok) throw new Error('controller now-playing fetch failed');
    const data = await res.json();
    // Maps the REAL fields we confirmed from routes/public.ts's /now-playing
    // handler — this part is not a guess, we read the actual source.
    return {
      isLive: data.streamOnline,
      streamUrl: `${CONTROLLER_API_URL}/stream.mp3`,
      currentDj: data.dj ? { name: data.dj.name, avatar: data.dj.avatar } : null,
      currentShow: data.activeShow ? { name: data.activeShow.name } : null,
      track: data.nowPlaying
        ? {
            title: data.nowPlaying.title,
            artist: data.nowPlaying.artist ?? null,
            album: data.nowPlaying.album ?? null,
          }
        : null,
      listeners: data.listeners ?? null,
    };
  }
}
