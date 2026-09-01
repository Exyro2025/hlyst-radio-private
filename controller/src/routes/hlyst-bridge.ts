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
import * as djMemory from '../broadcast/dj-agent/dj-memory.js';
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
// Vince Morgan imaging cooldown — station imaging shouldn't stack on top of
// itself every few minutes. In-memory is fine: one controller process, and a
// restart resetting the clock to "cooldown clear" is the safe failure mode.
const VM_IMAGING_COOLDOWN_MS = 20 * 60_000;
let lastVmImagingAt = 0;
// Read-only cooldown snapshot for the debug panel — never mutates state.
export function vmImagingCooldownStatus() {
  const sinceLast = Date.now() - lastVmImagingAt;
  const remainingMs = Math.max(0, VM_IMAGING_COOLDOWN_MS - sinceLast);
  return {
    lastFiredAt: lastVmImagingAt ? new Date(lastVmImagingAt).toISOString() : null,
    cooldownMs: VM_IMAGING_COOLDOWN_MS,
    remainingMs,
    onCooldown: remainingMs > 0,
  };
}
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
  if (kind === 'vm-imaging') {
    const sinceLast = Date.now() - lastVmImagingAt;
    if (sinceLast < VM_IMAGING_COOLDOWN_MS) {
      const retryAfterSec = Math.ceil((VM_IMAGING_COOLDOWN_MS - sinceLast) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: `vm-imaging is on cooldown, ${retryAfterSec}s remaining`,
        retryAfterSec,
      });
    }
    lastVmImagingAt = Date.now();
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

// GET /hlyst/transition-claim?target=<incoming DJ name>
router.get('/hlyst/transition-claim', requireAdmin, (req, res) => {
  const target = String(req.query.target ?? '').trim();
  if (!target) return res.status(400).json({ error: 'target is required' });
  const claimed = djMemory.transitionClaimed(djMemory.transitionKey(target));
  res.json({ claimed });
});

// POST /hlyst/transition-claim  { target }
router.post('/hlyst/transition-claim', requireAdmin, (req, res) => {
  const target = String((req.body ?? {}).target ?? '').trim();
  if (!target) return res.status(400).json({ error: 'target is required' });
  djMemory.claimTransition(djMemory.transitionKey(target));
  res.json({ ok: true });
});