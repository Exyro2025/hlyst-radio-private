// Reports the real, current state of every piece the DJ Engine depends on —
// nothing here is simulated. A missing table or unset env var is reported
// as exactly that, not hidden or guessed around. This is what the Engine
// Health tab reads.

import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

async function isAuthed() {
  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

async function tableStatus(query: () => Promise<unknown[]>): Promise<{ ok: boolean; count?: number; error?: string }> {
  try {
    const rows = await query();
    const count = Number((rows[0] as { count?: unknown })?.count ?? 0);
    return { ok: true, count };
  } catch (e) {
    // Most common cause: the table/column doesn't exist yet (relation does
    // not exist / column does not exist) — that's an honest "not set up",
    // not a system failure, so it's reported as ok:false with the reason
    // rather than a 500.
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [personas, schedule, approvedTalkWave] = await Promise.all([
    tableStatus(() => sql`SELECT COUNT(*) FROM personas`),
    tableStatus(() => sql`SELECT COUNT(*) FROM schedule`),
    tableStatus(() => sql`SELECT COUNT(*) FROM messages WHERE approved_at IS NOT NULL`),
  ]);

  const imagingPersona = personas.ok
    ? await tableStatus(() => sql`SELECT COUNT(*) FROM personas WHERE is_imaging = true`)
    : { ok: false, error: 'personas table not available' };

  const voicesAssigned = personas.ok
    ? await tableStatus(() => sql`SELECT COUNT(*) FROM personas WHERE tts_voice_id != ''`)
    : { ok: false, error: 'personas table not available' };

  return Response.json({
    checkedAt: new Date().toISOString(),
    elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
    llmConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY),
    live365Configured: Boolean(process.env.LIVE365_STATION_ID && process.env.LIVE365_STREAM_URL),
    talkWaveEngineSecretConfigured: Boolean(process.env.TALKWAVE_ENGINE_SECRET),
    personasTable: personas,
    scheduleTable: schedule,
    imagingPersonaCount: imagingPersona,
    voicesAssignedCount: voicesAssigned,
    talkWaveApprovedColumnReady: approvedTalkWave,
  });
}
