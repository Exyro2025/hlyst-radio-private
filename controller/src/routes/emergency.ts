// Admin-gated Extraordinary Event Mode controls (brief §22). Manual
// activation/deactivation only — see broadcast/emergency-mode.ts for why
// there is no automatic trigger here.
import express from 'express';
import { requireAdmin } from '../middleware/auth.js';
import * as emergencyMode from '../broadcast/emergency-mode.js';

export const router = express.Router();

// GET /emergency/status — current state + recent activation history, for the
// admin dashboard to show plainly whether the station is in this mode.
router.get('/emergency/status', requireAdmin, (req, res) => {
  res.json(emergencyMode.status());
});

// POST /emergency/activate  { reason: string }
router.post('/emergency/activate', requireAdmin, (req, res) => {
  const reason = String((req.body ?? {}).reason ?? '').trim();
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  const by = (req as any).adminUser || 'admin';
  emergencyMode.activate(reason, by);
  res.json({ ok: true, status: emergencyMode.status() });
});

// POST /emergency/deactivate
router.post('/emergency/deactivate', requireAdmin, (req, res) => {
  const by = (req as any).adminUser || 'admin';
  emergencyMode.deactivate(by);
  res.json({ ok: true, status: emergencyMode.status() });
});