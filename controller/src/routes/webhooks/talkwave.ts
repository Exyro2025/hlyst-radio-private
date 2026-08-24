// The "ear" that listens for Talk Wave's news.
//
// Place this file at: controller/src/routes/webhooks/talkwave.ts
// (create the routes/webhooks/ folder if it doesn't already exist)
//
// Written as an Express-style router. If your controller uses a different
// web framework, the shape (verify secret -> parse body -> store state ->
// respond 200) stays the same, only the syntax around it changes.

import { Router, type Request, type Response } from 'express';
import { normalizeTalkState } from '../../broadcast/now-playing-normalize.js';
import type { TalkWaveWebhookPayload, NowPlaying } from '../../broadcast/now-playing-shared.js';

// In-memory holder for "what Talk Wave last told us." A real deployment
// might persist this to disk the same way queue.ts persists its own state,
// but starting in-memory keeps this drop-in simple. Exported so the
// Now Playing route (wherever it lives) can read it.
let _latestTalkState: NowPlaying | null = null;
let _talkStateExpiresAt = 0;

// How long a "segment.start" stays authoritative without a follow-up event.
// If Talk Wave goes silent (crashes, network issue) for longer than this,
// we stop trusting it was still live and fall back to the music state.
const TALK_STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getCurrentTalkState(): NowPlaying | null {
  if (!_latestTalkState) return null;
  if (Date.now() > _talkStateExpiresAt) return null;
  return _latestTalkState;
}

const router = Router();

router.post('/webhooks/talkwave', (req: Request, res: Response) => {
  // TODO: verify a shared secret the same way HLYST's own webhook sender
  // supports an authHeader — reject anything without the right header so a
  // random POST to this URL can't spoof a fake talk segment on air.
  const authHeader = req.headers['authorization'];
  const expectedSecret = process.env.TALKWAVE_WEBHOOK_SECRET;
  if (expectedSecret && authHeader !== expectedSecret) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const payload = req.body as TalkWaveWebhookPayload;
  if (!payload?.event) {
    res.status(400).json({ error: 'missing event field' });
    return;
  }

  if (payload.event === 'segment.start') {
    _latestTalkState = normalizeTalkState(payload);
    _talkStateExpiresAt = Date.now() + TALK_STATE_TTL_MS;
  } else if (payload.event === 'segment.end') {
    _latestTalkState = null;
    _talkStateExpiresAt = 0;
  }
  // Unknown event types are accepted but ignored — forward-compatible with
  // Talk Wave adding new event kinds later without breaking this endpoint.

  res.status(200).json({ ok: true });
});

export default router;
