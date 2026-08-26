// The real decide-then-generate-then-log pipeline. Two ways in:
//  - Admin session cookie (the "Run engine tick now" button in the UI)
//  - Authorization: Bearer <HLYST_ENGINE_CRON_SECRET> (an external scheduler
//    — GitHub Actions — calling this on a real cadence). This is a secret
//    we own, not Vercel's auto-provisioned CRON_SECRET, since we're
//    deliberately not using Vercel Cron (see HLYST_ENGINE_CRON_SECRET in
//    .env.example for why).
//
// Idempotent by design: a "claim" row is inserted with a deterministic
// tick_key BEFORE any LLM call happens. If another tick already claimed
// that exact key (UNIQUE(persona_id, tick_key)), this run backs off
// immediately — no duplicate break, no wasted LLM call. This matters
// because the trigger (GitHub Actions cron) is explicitly best-effort and
// can occasionally double-fire or overlap.
//
// Every invocation — whether it spoke, stayed silent, or hit a duplicate —
// is logged to engine_tick_log, so scheduler health is visible from the
// Control Room independent of whether anything was actually generated.

import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { buildDjSystemPrompt, type EnginePersona } from '@/lib/djPrompt.server';
import { callLLM } from '@/lib/llm.server';
import { decideBreak, type BreakDecisionInput, type BreakType } from '@/lib/breakDecision';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

const STATION_TIMEZONE = 'America/New_York';
const SLOT_STARTS = [2, 6, 10, 14, 18, 22];

async function isAuthed(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.HLYST_ENGINE_CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

function resolveSlotAndProgress(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STATION_TIMEZONE,
    weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const dayOfWeek = get('weekday');
  let hour = Number(get('hour'));
  const minute = Number(get('minute'));
  if (hour === 24) hour = 0;
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;

  const firstStart = SLOT_STARTS[0]!;
  let blockHour = hour < firstStart ? 22 : firstStart;
  for (const s of SLOT_STARTS) if (hour >= s) blockHour = s;

  const nowMinutesIntoDay = hour * 60 + minute;
  const blockStartMinutesIntoDay = blockHour * 60;
  let minutesIntoShow = nowMinutesIntoDay - blockStartMinutesIntoDay;
  if (minutesIntoShow < 0) minutesIntoShow += 24 * 60;
  const minutesUntilShowEnd = 240 - minutesIntoShow;

  return {
    dayOfWeek, startTime: `${String(blockHour).padStart(2, '0')}:00`,
    minutesIntoShow, minutesUntilShowEnd, dateStr, hour, minute,
  };
}

// Deterministic dedup key. Includes the actual calendar date, not just the
// recurring day name — a show_open key scoped to "Monday:06:00" alone would
// block that slot forever after its first real Monday, since day-of-week
// repeats every week. Scoping to dateStr fixes that.
function computeTickKey(breakType: BreakType, dateStr: string, hour: number, minute: number, startTime: string): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  if (breakType === 'show_open' || breakType === 'show_close') return `${breakType}:${dateStr}:${startTime}`;
  if (breakType === 'hourly') return `hourly:${dateStr}:${hh}`;
  if (breakType === 'station_id') return `station_id:${dateStr}:${hh}:${mm}`;
  return `${breakType}:${dateStr}:${hh}:${mm}`; // ad_lib, talkwave_response — per-minute granularity
}

const BREAK_PROMPTS: Record<Exclude<BreakType, 'talkwave_response'>, string> = {
  show_open: 'Open your show. This is the first thing listeners hear from you today.',
  show_close: 'Wrap your show — you\'re handing off to the next DJ shortly.',
  station_id: 'Give a brief station identification for HLYST.',
  hourly: 'Give a brief time check for listeners.',
  ad_lib: 'Give a short, natural aside — nothing tied to a specific song or event, just a moment of your personality.',
};

async function logTick(entry: {
  personaId: string | null; shouldSpeak: boolean; breakType: string | null;
  reason: string; skippedDuplicate: boolean; errorDetail: string | null;
}) {
  await sql`
    INSERT INTO engine_tick_log (persona_id, should_speak, break_type, reason, skipped_duplicate, error_detail)
    VALUES (${entry.personaId}, ${entry.shouldSpeak}, ${entry.breakType}, ${entry.reason}, ${entry.skippedDuplicate}, ${entry.errorDetail})
  `;
}

export async function POST(req: Request) {
  if (!(await isAuthed(req))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const { dayOfWeek, startTime, minutesIntoShow, minutesUntilShowEnd, dateStr, hour, minute } = resolveSlotAndProgress(now);

  const personaRows = await sql`
    SELECT p.id, p.name, p.soul, p.frequency, p.dj_mode, p.humour, p.local_colour, p.warmth, p.language
    FROM schedule s
    JOIN personas p ON p.id = s.persona_id
    WHERE s.day_of_week = ${dayOfWeek} AND s.start_time = ${startTime}
    LIMIT 1
  `;
  if (!personaRows.length) {
    await logTick({ personaId: null, shouldSpeak: false, breakType: null, reason: 'No persona resolves for the current schedule slot.', skippedDuplicate: false, errorDetail: null });
    return Response.json({ shouldSpeak: false, reason: 'No persona resolves for the current schedule slot.' });
  }
  const p = personaRows[0] as any;
  const personaId: string = p.id;

  const lastBreakRows = await sql`
    SELECT break_type, created_at FROM dj_breaks
    WHERE persona_id = ${personaId} AND status != 'error' ORDER BY created_at DESC LIMIT 1
  `;
  const lastBreakAt = lastBreakRows.length ? new Date((lastBreakRows[0] as any).created_at) : null;
  const lastBreakType = lastBreakRows.length ? ((lastBreakRows[0] as any).break_type as BreakType) : null;

  const talkWaveCountRows = await sql`
    SELECT COUNT(*) FROM messages WHERE status = 'approved' AND used_at IS NULL
  `;
  const approvedTalkWaveCount = Number((talkWaveCountRows[0] as any).count);

  const decisionInput: BreakDecisionInput = {
    frequency: p.frequency, djMode: p.dj_mode, now, minutesIntoShow, minutesUntilShowEnd,
    lastBreakAt, lastBreakType, approvedTalkWaveCount,
  };
  const decision = decideBreak(decisionInput);

  if (!decision.shouldSpeak) {
    await logTick({ personaId, shouldSpeak: false, breakType: null, reason: decision.reason, skippedDuplicate: false, errorDetail: null });
    return Response.json({ ...decision, personaId, personaName: p.name });
  }

  const tickKey = computeTickKey(decision.breakType!, dateStr, hour, minute, startTime);

  // Claim the slot BEFORE doing any LLM work. If another tick already
  // claimed this exact key, this INSERT returns no row and we back off —
  // no duplicate break, no wasted API call.
  const claimRows = await sql`
    INSERT INTO dj_breaks (persona_id, break_type, reason, text, status, context, intended_air_time, tick_key)
    VALUES (${personaId}, ${decision.breakType}, ${decision.reason}, '', 'pending',
      ${JSON.stringify({ dayOfWeek, startTime, minutesIntoShow })}, ${now.toISOString()}, ${tickKey})
    ON CONFLICT (persona_id, tick_key) DO NOTHING
    RETURNING id
  `;
  if (!claimRows.length) {
    await logTick({ personaId, shouldSpeak: true, breakType: decision.breakType!, reason: decision.reason, skippedDuplicate: true, errorDetail: null });
    return Response.json({ ...decision, personaId, personaName: p.name, skipped: 'duplicate tick — another run already claimed this slot' });
  }
  const claimedId = (claimRows[0] as any).id;

  const enginePersona: EnginePersona = {
    name: p.name, soul: p.soul, humour: p.humour, localColour: p.local_colour, warmth: p.warmth, language: p.language,
  };
  const systemPrompt = buildDjSystemPrompt(enginePersona);

  let talkWaveItem: { id: number; message: string } | null = null;
  let userPrompt: string;
  if (decision.breakType === 'talkwave_response') {
    const itemRows = await sql`
      SELECT id, message FROM messages
      WHERE status = 'approved' AND used_at IS NULL
      ORDER BY approved_at ASC NULLS LAST LIMIT 1
    `;
    if (itemRows.length) {
      talkWaveItem = itemRows[0] as any;
      userPrompt = `A listener sent in this message: "${talkWaveItem!.message}". Acknowledge it naturally, briefly.`;
    } else {
      userPrompt = BREAK_PROMPTS.ad_lib;
    }
  } else {
    userPrompt = BREAK_PROMPTS[decision.breakType as Exclude<BreakType, 'talkwave_response'>];
  }

  try {
    const { text } = await callLLM(systemPrompt, userPrompt);

    await sql`UPDATE dj_breaks SET text = ${text}, status = 'generated' WHERE id = ${claimedId}`;

    if (talkWaveItem) {
      await sql`
        UPDATE messages SET used_at = now(), used_by_dj = ${personaId}, used_by_show = ${startTime}
        WHERE id = ${talkWaveItem.id}
      `;
    }

    await logTick({ personaId, shouldSpeak: true, breakType: decision.breakType!, reason: decision.reason, skippedDuplicate: false, errorDetail: null });
    return Response.json({ ...decision, personaId, personaName: p.name, text });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Generation failed.';
    await sql`UPDATE dj_breaks SET status = 'error', error_detail = ${message} WHERE id = ${claimedId}`;
    await logTick({ personaId, shouldSpeak: true, breakType: decision.breakType!, reason: decision.reason, skippedDuplicate: false, errorDetail: message });
    return Response.json({ ...decision, personaId, personaName: p.name, error: message }, { status: 502 });
  }
}
