// The ONE external contract between the Vercel-hosted HLYST engine and
// SUB/WAVE's real broadcast queue. HLYST renders its own audio (ElevenLabs,
// on its own infrastructure) and hands the finished file to this route —
// SUB/WAVE never re-renders it, per the single-audio-authority rule.
//
// Auth reuses the same ADMIN_USER/ADMIN_PASS Basic Auth every other admin
// route uses — HLYST's Vercel functions call this server-to-server with an
// Authorization header, not a browser, so there's no CORS involved at all.

import express from 'express';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { requireAdmin } from '../middleware/auth.js';
import { config } from '../config.js';
import { queue } from '../broadcast/queue.js';

export const router = express.Router();

// Kinds that ride into the NEXT track transition rather than airing the
// instant they arrive — the same reasoning announceAtNextTrack() already
// encodes: HLYST doesn't know SUB/WAVE's exact upcoming track, so instead of
// guessing, these wait for whatever boundary SUB/WAVE reaches next. Every
// other kind (station-id, handoff, banter, talkwave, promo) airs immediately.
const DEFERRED_KINDS = new Set(['dj-speak', 'link', 'vm-imaging']);

const ALLOWED_KINDS = new Set([
  'dj-speak', 'link', 'station-id', 'hourly-check', 'handoff', 'banter',
  'talkwave', 'vm-imaging', 'promo',
]);

async function downloadToLocalWav(audioUrl: string): Promise<string> {
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`could not fetch audioUrl (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = config.piper.outDir;
  await mkdir(dir, { recursive: true });
  const id = randomBytes(6).toString('hex');
  const outPath = path.join(dir, `hlyst-${id}.wav`);
  await writeFile(outPath, buf);
  return outPath;
}

// POST /hlyst/broadcast
// Body: { kind, text, audioUrl, personaId?, personaName?, djMode?, deferred? }
router.post('/hlyst/broadcast', requireAdmin, async (req, res) => {
  const { kind, text, audioUrl, personaId, personaName, djMode, deferred } = req.body ?? {};

  if (!ALLOWED_KINDS.has(kind)) {
    return res.status(400).json({ error: `kind must be one of: ${[...ALLOWED_KINDS].join(', ')}` });
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (!audioUrl || typeof audioUrl !== 'string') {
    return res.status(400).json({ error: 'audioUrl is required — this route never renders audio itself' });
  }

  const persona = personaId ? { id: personaId, name: personaName ?? null, djMode: !!djMode } : null;
  const holdForBoundary = typeof deferred === 'boolean' ? deferred : DEFERRED_KINDS.has(kind);

  try {
    const wavPath = await downloadToLocalWav(audioUrl);

    if (holdForBoundary) {
      await queue.announceAtNextTrack(text, kind, { persona, wavPath });
      return res.json({ ok: true, kind, aired: false, held: true, spoken: text });
    }

    await queue.announce(text, kind, { persona, wavPath });
    return res.json({ ok: true, kind, aired: true, held: false, spoken: text });
  } catch (err) {
    queue.log('error', `/hlyst/broadcast (${kind}) failed: ${(err as Error).message}`);
    res.status(502).json({ error: (err as Error).message });
  }
});
