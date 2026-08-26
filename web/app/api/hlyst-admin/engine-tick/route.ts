// The actual decide-then-generate-then-log pipeline — what a real
// scheduled job would call every few minutes. For now this is manually
// triggerable from the admin UI; wiring a real cron to hit this is a
// separate, later step (Vercel Cron or similar), not built yet.
//
// Text-only, same as generate-break/route.ts: no TTS, no air. Talk Wave
// integration here only pulls from `messages` (text) — `voice_notes` are
// audio and would need transcription to read aloud, which isn't built;
// they're honestly excluded rather than silently ignored without a note.

import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { buildDjSystemPrompt, type EnginePersona } from '@/lib/djPrompt.server';
import { callLLM } from '@/lib/llm.server';
import { decideBreak, type BreakDecisionInput, type BreakType } from '@/lib/breakDecision';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

const STATION_TIMEZONE = 'America/New_York';
const SLOT_STARTS = [2, 6, 10, 14, 18, 22];
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

async function isAuthed() {
  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

function resolveSlotAndProgress(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STATION_TIMEZONE,
    weekday: 'long',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const dayOfWeek = parts.find((p) => p.type === 'weekday')!.value;
  let hour = Number(parts.find((p) => p.type === 'hour')!.value);
  const minute = Number(parts.find((p) => p.type === 'minute')!.value);
  if (hour === 24) hour = 0;

  const firstStart = SLOT_STARTS[0]!;
  let blockHour = hour < firstStart ? 22 : firstStart;
  for (const s of SLOT_STARTS) if (hour >= s) blockHour = s;

  const nowMinutesIntoDay = hour * 60 + minute;
  const blockStartMinutesIntoDay = blockHour * 60;
  let minutesIntoShow = nowMinutesIntoDay - blockStartMinutesIntoDay;
  if (minutesIntoShow < 0) minutesIntoShow += 24 * 60; // wrapped past midnight into the 22:00 block
  const minutesUntilShowEnd = 240 - minutesIntoShow; // every slot is a fixed 4-hour block

  return {
    dayOfWeek,
    startTime: `${String(blockHour).padStart(2, '0')}:00`,
    minutesIntoShow,
    minutesUntilShowEnd,
  };
}

const BREAK_PROMPTS: Record<Exclude<BreakType, 'talkwave_response'>, string> = {
  show_open: 'Open your show. This is the first thing listeners hear from you today.',
  show_close: 'Wrap your show — you\'re handing off to the next DJ shortly.',
  station_id: 'Give a brief station identification for HLYST.',
  hourly: 'Give a brief time check for listeners.',
  ad_lib: 'Give a short, natural aside — nothing tied to a specific song or event, just a moment of your personality.',
};

export async function POST() {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const { dayOfWeek, startTime, minutesIntoShow, minutesUntilShowEnd } = resolveSlotAndProgress(now);

  const personaRows = await sql`
    SELECT p.id, p.name, p.soul, p.frequency, p.dj_mode, p.humour, p.local_colour, p.warmth, p.language
    FROM schedule s
    JOIN personas p ON p.id = s.persona_id
    WHERE s.day_of_week = ${dayOfWeek} AND s.start_time = ${startTime}
    LIMIT 1
  `;
  if (!personaRows.length) {
    return Response.json({ shouldSpeak: false, reason: 'No persona resolves for the current schedule slot.' });
  }
  const p = personaRows[0] as any;
  const personaId: string = p.id;

  const lastBreakRows = await sql`
    SELECT break_type, created_at FROM dj_breaks
    WHERE persona_id = ${personaId} ORDER BY created_at DESC LIMIT 1
  `;
  const lastBreakAt = lastBreakRows.length ? new Date((lastBreakRows[0] as any).created_at) : null;
  const lastBreakType = lastBreakRows.length ? ((lastBreakRows[0] as any).break_type as BreakType) : null;

  const talkWaveCountRows = await sql`
    SELECT COUNT(*) FROM messages WHERE status = 'approved' AND used_at IS NULL
  `;
  const approvedTalkWaveCount = Number((talkWaveCountRows[0] as any).count);

  const decisionInput: BreakDecisionInput = {
    frequency: p.frequency,
    djMode: p.dj_mode,
    now,
    minutesIntoShow,
    minutesUntilShowEnd,
    lastBreakAt,
    lastBreakType,
    approvedTalkWaveCount,
  };

  const decision = decideBreak(decisionInput);

  if (!decision.shouldSpeak) {
    return Response.json({ ...decision, personaId, personaName: p.name });
  }

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
      // Count said one was available but it's gone by the time we look —
      // fall back to an ad-lib rather than fail the whole tick.
      userPrompt = BREAK_PROMPTS.ad_lib;
    }
  } else {
    userPrompt = BREAK_PROMPTS[decision.breakType as Exclude<BreakType, 'talkwave_response'>];
  }

  try {
    const { text } = await callLLM(systemPrompt, userPrompt);

    await sql`
      INSERT INTO dj_breaks (persona_id, break_type, reason, text, status, context, intended_air_time)
      VALUES (${personaId}, ${decision.breakType}, ${decision.reason}, ${text}, 'generated',
        ${JSON.stringify({ dayOfWeek, startTime, minutesIntoShow, talkWaveItemId: talkWaveItem?.id ?? null })}, ${now.toISOString()})
    `;

    if (talkWaveItem) {
      await sql`
        UPDATE messages SET used_at = now(), used_by_dj = ${personaId}, used_by_show = ${startTime}
        WHERE id = ${talkWaveItem.id}
      `;
    }

    return Response.json({ ...decision, personaId, personaName: p.name, text });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Generation failed.';
    await sql`
      INSERT INTO dj_breaks (persona_id, break_type, reason, text, status, context, intended_air_time, error_detail)
      VALUES (${personaId}, ${decision.breakType}, ${decision.reason}, '', 'error',
        ${JSON.stringify({ dayOfWeek, startTime, minutesIntoShow })}, ${now.toISOString()}, ${message})
    `;
    return Response.json({ ...decision, personaId, personaName: p.name, error: message }, { status: 502 });
  }
}
