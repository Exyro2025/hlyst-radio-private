// Client-safe. Fetches the resolved on-air/coming-up persona from the
// server-side /api/on-air route — the ONLY place that talks to Postgres.
// Never import a database client into this file: it's bundled straight
// into the browser, and a connection string here would leak.
//
// This replaces the old version, which parsed schedule strings out of
// djs.ts with regex. Postgres (schedule + personas tables) is now the
// canonical source for WHO is on air; djs.ts is used only for display
// fields (portrait, bio, slug), looked up server-side by name.

import type { DjProfile } from './djs';

export interface ComingUpResult {
  dj: DjProfile;
  startsAt: string;
}

export interface OnAirResult {
  onAir: DjProfile | null;
  comingUp: ComingUpResult | null;
}

export async function fetchOnAir(): Promise<OnAirResult> {
  try {
    const res = await fetch('/api/on-air');
    if (!res.ok) return { onAir: null, comingUp: null };
    return await res.json();
  } catch {
    return { onAir: null, comingUp: null };
  }
}
