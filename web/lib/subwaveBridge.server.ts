// The HLYST-side half of the SUB/WAVE bridge (the other half is
// controller/src/routes/hlyst-bridge.ts). Optional by design: no-ops with a
// clear error when SUBWAVE_CONTROLLER_URL isn't set, which is expected until
// SUB/WAVE is actually deployed — callers treat that as a normal failure to
// isolate, not a crash.
export interface SubwaveBreakPayload {
  kind: string;
  text: string;
  audioUrl: string;
  personaId?: string;
  personaName?: string;
  djMode?: boolean;
  deferred?: boolean;
}
export async function sendToSubwave(payload: SubwaveBreakPayload): Promise<void> {
  const url = process.env.SUBWAVE_CONTROLLER_URL;
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!url) {
    throw new Error('SUBWAVE_CONTROLLER_URL is not set — SUB/WAVE is not deployed yet.');
  }
  if (!user || !pass) {
    throw new Error('ADMIN_USER/ADMIN_PASS are not set — cannot authenticate to the controller.');
  }
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const res = await fetch(`${url}/hlyst/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `SUB/WAVE bridge returned ${res.status}`);
  }
}

// Shared-airtime coordination (DJ HANDOFF vs Vince Morgan imaging) — the
// HLYST-side half of dj-memory.ts's transition-claim functions, reached via
// controller/src/routes/hlyst-bridge.ts's /hlyst/transition-claim endpoint.
// Both fail SAFE toward today's behaviour: if the bridge isn't configured or
// the call fails, isTransitionClaimed reports "not claimed" (never blocks
// Vince) and claimTransition just no-ops (never blocks or fails the tick).
export async function isTransitionClaimed(target: string): Promise<boolean> {
  const url = process.env.SUBWAVE_CONTROLLER_URL;
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!url || !user || !pass) return false;
  try {
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    const res = await fetch(`${url}/hlyst/transition-claim?target=${encodeURIComponent(target)}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return false;
    const body = await res.json();
    return !!body.claimed;
  } catch {
    return false;
  }
}

export async function claimTransition(target: string): Promise<void> {
  const url = process.env.SUBWAVE_CONTROLLER_URL;
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!url || !user || !pass) return;
  try {
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    await fetch(`${url}/hlyst/transition-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({ target }),
    });
  } catch {
    // best-effort — a failed claim just means a slightly higher chance of a
    // rare double-cover next cycle, never a broken tick.
  }
}