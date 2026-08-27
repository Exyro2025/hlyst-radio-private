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
import { synthesizeSpeech } from '@/lib/elevenlabs.server';
import { uploadBreakAudio } from '@/lib/audioStorage.server';
import { sendToSubwave } from '@/lib/subwaveBridge.server';

// HLYST's own break types → SUB/WAVE's queue kinds (controller/src/broadcast/
// queue/kinds.ts). talkwave_response and station_id/hourly air immediately;
// everything else rides into the next track transition — see DEFERRED_KINDS
// in controller/src/routes/hlyst-bridge.ts, which this mapping must agree with.
const BRIDGE_KIND: Record<BreakType, string> = {
  show_open: 'dj-speak',
  show_close: 'dj-speak',
  station_id: 'station-id',
  hourly: 'hourly-check',
  ad_lib: 'dj-speak',
  talkwave_response: 'talkwave',
};

// VM (Vince Morgan) fires opportunistically at real station transitions only
// — never a scheduled DJ, never every tick. Global cooldown (across every
// approved element, not per-element) is the "do not over-trigger" gate the
// spec asks for; 90 min keeps him rare against ~42 weekly show boundaries
// without pinning him to a fixed schedule of his own.
const VM_TRANSITION_TYPES: BreakType[] = ['show_open', 'show_close'];
const VM_MIN_GAP_MINUTES = 90;

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

function computeTickKey(breakType: BreakType, dateStr: string, hour: number, minute: number, startTime: string): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  if (breakType === 'show_open' || breakType === 'show_close') return `${breakType}:${dateStr}:${startTime}`;
  if (breakType === 'hourly') return `hourly:${dateStr}:${hh}`;
  if (breakType === 'station_id') return `station_id:${dateStr}:${hh}:${mm}`;
  return `${breakType}:${dateStr}:${hh}:${mm}`;
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
    SELECT p.id, p.name, p.soul, p.frequency, p.dj_mode, p.humour, p.local_colour, p.warmth, p.language, p.tts_voice_id, p.tts_engine
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

  let approvedTalkWaveCount = 0;
  try {
    const talkWaveCountRows = await sql`
      SELECT COUNT(*) FROM messages WHERE status = 'approved' AND used_at IS NULL
    `;
    approvedTalkWaveCount = Number((talkWaveCountRows[0] as any).count);
  } catch {
    approvedTalkWaveCount = 0;
  }

  const decisionInput: BreakDecisionInput = {
    frequency: p.frequency, djMode: p.dj_mode, now, minutesIntoShow, minutesUntilShowEnd,
    lastBreakAt, lastBreakType, approvedTalkWaveCount,
  };
    const decision = decideBreak(decisionInput);

  // Promotions run on every tick, independent of whether the DJ is speaking
  // this cycle — they're background rotation, not a DJ break. Eligibility:
  // active, inside its start/end window (a past end_at is a promo that has
  // simply expired — no separate cron needed), station-wide or scoped to
  // this persona, and outside its own minimum separation. Never a parallel
  // playout path — an eligible promo goes through the exact same bridge call
  // as every other station-production element.
  try {
    const promoRows = await sql`
      SELECT id, title, audio_url, min_separation_minutes FROM promotions
      WHERE active = true
        AND (start_at IS NULL OR start_at <= ${now.toISOString()})
        AND (end_at IS NULL OR end_at > ${now.toISOString()})
        AND (eligible_persona_ids = '{}' OR ${personaId} = ANY(eligible_persona_ids))
        AND (
          last_used_at IS NULL
          OR last_used_at <= ${now.toISOString()}::timestamptz - (min_separation_minutes || ' minutes')::interval
        )
      ORDER BY random() LIMIT 1
    `;
    if (promoRows.length) {
      const promo = promoRows[0] as any;
      await sendToSubwave({
        kind: 'promo',
        text: promo.title,
        audioUrl: promo.audio_url,
        personaId,
        personaName: p.name,
      });
      await sql`UPDATE promotions SET times_used = times_used + 1, last_used_at = now() WHERE id = ${promo.id}`;
    }
  } catch {
    // Promotions are opportunistic, same as VM — never affect the DJ break.
  }

  if (!decision.shouldSpeak) {
    await logTick({ personaId, shouldSpeak: false, breakType: null, reason: decision.reason, skippedDuplicate: false, errorDetail: null });
    return Response.json({ ...decision, personaId, personaName: p.name });
  }

  const tickKey = computeTickKey(decision.breakType!, dateStr, hour, minute, startTime);

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
  let spotlightTrack: { id: number; title: string; artist: string } | null = null;
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
  } else if (decision.breakType === 'ad_lib') {
    const spotlightRows = await sql`
      SELECT id, title, artist FROM artist_music
      WHERE release_status = 'NEW_RELEASE'
      ORDER BY last_featured_at ASC NULLS FIRST
      LIMIT 1
    `;
    if (spotlightRows.length) {
      spotlightTrack = spotlightRows[0] as any;
      userPrompt = `Give a short, natural aside spotlighting "${spotlightTrack!.title}" by ${spotlightTrack!.artist} — a real new release. You may call it new, since it genuinely is. Don't invent details about it beyond the title and artist.`;
    } else {
      userPrompt = BREAK_PROMPTS.ad_lib;
    }
  } else {
    userPrompt = BREAK_PROMPTS[decision.breakType as Exclude<BreakType, 'talkwave_response'>];
  }

  try {
    const { text } = await callLLM(systemPrompt, userPrompt);

    await sql`UPDATE dj_breaks SET text = ${text}, status = 'generated' WHERE id = ${claimedId}`;

    // Audio rendering is isolated from text generation on purpose — per
    // the failure-isolation rule, a break with real text but no audio
    // still counts as generated. Nothing here can turn a successful text
    // generation into a logged error.
    if (p.tts_voice_id && process.env.ELEVENLABS_API_KEY) {
      try {
        let audioBuffer = await synthesizeSpeech(text, p.tts_voice_id);

                // No bed mixing here — SUB/WAVE is the single audio authority per the
        // spec (Section 3). HLYST hands over clean speech only; SUB/WAVE's own
        // bed-policy decides talk-over vs. bed vs. incoming-song ramp once the
        // bridge call below reaches it.
        const audioUrl = await uploadBreakAudio(audioBuffer, claimedId);
        await sql`UPDATE dj_breaks SET audio_url = ${audioUrl}, audio_status = 'rendered' WHERE id = ${claimedId}`;

        // Hand the rendered break to SUB/WAVE's real broadcast queue. Failure
        // is isolated the same way audio rendering itself is above — a break
        // that's generated and rendered but never reaches SUB/WAVE (no
        // deployment yet, a network blip) still counts as a successful tick;
        // it just never airs. That gap is visible in dj_breaks.bridge_status,
        // not swallowed silently.
        try {
                    await sendToSubwave({
            kind: BRIDGE_KIND[decision.breakType!],
            text,
            audioUrl,
            personaId,
            personaName: p.name,
            djMode: !!p.dj_mode,
          });
          await sql`UPDATE dj_breaks SET bridge_status = 'sent' WHERE id = ${claimedId}`;
        } catch (bridgeError) {
          const bridgeMessage = bridgeError instanceof Error ? bridgeError.message : 'Bridge call failed.';
          await sql`UPDATE dj_breaks SET bridge_status = 'failed', bridge_error = ${bridgeMessage} WHERE id = ${claimedId}`;
        }

        // VM auto-trigger — entirely separate from the DJ break above, and
        // never allowed to affect its success. Only considered on a real
        // transition tick, and only when the global cooldown has cleared.
        if (VM_TRANSITION_TYPES.includes(decision.breakType!)) {
          try {
            const cooldownRows = await sql`
              SELECT last_used_at FROM vm_imaging
              WHERE last_used_at IS NOT NULL
              ORDER BY last_used_at DESC LIMIT 1
            `;
            const lastVmAt = cooldownRows.length ? new Date((cooldownRows[0] as any).last_used_at) : null;
            const cooledDown = !lastVmAt || (now.getTime() - lastVmAt.getTime()) >= VM_MIN_GAP_MINUTES * 60_000;

            if (cooledDown) {
              const vmRows = await sql`
                SELECT id, text, audio_url FROM vm_imaging
                WHERE status = 'approved' AND audio_status = 'rendered'
                ORDER BY random() LIMIT 1
              `;
              if (vmRows.length) {
                const vm = vmRows[0] as any;
                await sendToSubwave({
                  kind: 'vm-imaging',
                  text: vm.text,
                  audioUrl: vm.audio_url,
                  personaName: 'Vince Morgan',
                });
                await sql`UPDATE vm_imaging SET times_used = times_used + 1, last_used_at = now() WHERE id = ${vm.id}`;
              }
            }
          } catch {
            // Opportunistic only — a VM miss never affects the DJ break above.
          }
        }
    }

    if (talkWaveItem) {
      await sql`
        UPDATE messages SET used_at = now(), used_by_dj = ${personaId}, used_by_show = ${startTime}
        WHERE id = ${talkWaveItem.id}
      `;
    }

    if (spotlightTrack) {
      await sql`UPDATE artist_music SET last_featured_at = now() WHERE id = ${spotlightTrack.id}`;
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
