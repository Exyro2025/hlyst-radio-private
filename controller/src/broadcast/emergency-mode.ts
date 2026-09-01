// Extraordinary Event Mode (brief §22) — a manually-activated, durable
// station state for situations where normal cheerful programming would be
// obviously inappropriate (historic public-impact events only — never
// routine news, politics, or an ordinary severe-weather alert, which is
// severe-weather.ts's job, not this one's).
//
// Deliberately NOT wired to any automatic news/headline feed — the brief is
// explicit that a single internet headline must never autonomously trigger
// this. Activation is an owner/admin action (routes/emergency.ts) only.
//
// FEMA/IPAWS integration boundary: ingestIpawsAlert() below is where a real
// IPAWS feed would plug in once credentials/MOA are in place. It is not
// currently called by anything — the brief explicitly says pending FEMA
// registration must not block the rest of this feature, so the boundary
// exists and is ready, but nothing invents a feed that isn't there yet.
//
// Same persistence shape as dj-memory.ts/session.ts — debounced atomic
// write, survives a controller restart.

import { existsSync, readFileSync } from 'node:fs';
import { config } from '../config.js';
import { writeFileAtomic } from '../util/atomic-file.js';

export interface EmergencyState {
  active: boolean;
  activatedAt: string | null;
  activatedBy: string | null;
  reason: string | null;
  source: 'manual' | 'ipaws';
}

export interface EmergencyHistoryEntry {
  action: 'activate' | 'deactivate';
  at: string;
  by: string | null;
  reason: string | null;
  source: 'manual' | 'ipaws';
}

const MAX_HISTORY = 100;
const FILE = `${config.session.dir}/../emergency-mode.json`;

let state: EmergencyState = {
  active: false, activatedAt: null, activatedBy: null, reason: null, source: 'manual',
};
let history: EmergencyHistoryEntry[] = [];
let writeTimer: NodeJS.Timeout | null = null;

function load() {
  if (!existsSync(FILE)) return;
  try {
    const stored = JSON.parse(readFileSync(FILE, 'utf8'));
    if (stored?.state) state = stored.state;
    if (Array.isArray(stored?.history)) history = stored.history.slice(-MAX_HISTORY);
  } catch { /* start fresh */ }
}
load();

function schedulePersist() {
  if (writeTimer) return;
  writeTimer = setTimeout(async () => {
    writeTimer = null;
    try { await writeFileAtomic(FILE, JSON.stringify({ state, history }, null, 2)); } catch {}
  }, 500);
}

export function isActive(): boolean {
  return state.active;
}

export function status(): { state: EmergencyState; history: EmergencyHistoryEntry[] } {
  return { state: { ...state }, history: history.slice(-20) };
}

export function activate(reason: string, activatedBy: string, source: 'manual' | 'ipaws' = 'manual') {
  const at = new Date().toISOString();
  state = { active: true, activatedAt: at, activatedBy, reason: reason.trim().slice(0, 500), source };
  history.push({ action: 'activate', at, by: activatedBy, reason: state.reason, source });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  schedulePersist();
}

export function deactivate(deactivatedBy: string) {
  const at = new Date().toISOString();
  history.push({ action: 'deactivate', at, by: deactivatedBy, reason: state.reason, source: state.source });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  state = { active: false, activatedAt: null, activatedBy: null, reason: null, source: 'manual' };
  schedulePersist();
}

// FEMA/IPAWS integration boundary — not called by anything yet. Once a real
// feed is wired in (separate work, pending credentials per the brief), it
// should call this with the alert's own headline as `reason` — never invent
// one. Left unimplemented beyond the signature on purpose: no fetch loop, no
// polling, nothing that could silently "activate itself" on partial data.
export function ingestIpawsAlert(_alert: { headline: string; id: string }): void {
  throw new Error('ingestIpawsAlert is a placeholder — FEMA/IPAWS is not connected yet');
}