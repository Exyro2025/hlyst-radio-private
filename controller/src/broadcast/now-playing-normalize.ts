// Converts real data from two different sources into ONE shared shape.
// Place this file at: controller/src/broadcast/now-playing-normalize.ts

import type { NowPlaying, TalkWaveWebhookPayload } from './now-playing-shared.js';

// Build the shared shape from HLYST's own music state.
// `sessionShow` / `sessionPersona` come from session.getSession() —
// see session.ts's `show` and `persona` fields.
// `current` comes from queue.getNowPlaying() or queue.snapshot().current.
export function normalizeMusicState(
  sessionPersona: { id: string; name: string } | null,
  sessionShow: { id?: string; name?: string; topic?: string } | null,
  current: {
    title: string;
    artist: string | null;
    album: string | null;
    subsonic_id: string | null;
    startedAt: string | null;
  } | null,
): NowPlaying {
  return {
    blockType: 'music',
    isLive: true,
    currentDj: sessionPersona,
    currentShow: sessionShow,
    track: current
      ? {
          title: current.title,
          artist: current.artist,
          album: current.album,
          sourceTrackId: current.subsonic_id,
          startedAt: current.startedAt,
        }
      : null,
    talk: null,
  };
}

// Build the shared shape from a Talk Wave webhook payload.
export function normalizeTalkState(payload: TalkWaveWebhookPayload): NowPlaying {
  return {
    blockType: 'talk',
    isLive: true,
    currentDj: payload.host ?? null,
    currentShow: payload.show ?? null,
    track: null,
    talk: {
      segmentStatus: payload.segmentStatus,
      guest: payload.guest ?? null,
      artwork: payload.artwork ?? null,
      streamUrl: payload.streamUrl ?? null,
    },
  };
}
