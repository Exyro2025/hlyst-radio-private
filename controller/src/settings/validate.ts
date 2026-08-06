// Strict update() validators. Unlike the lenient normalizers in normalize.ts,
// these throw on invalid input — an operator saving from the admin UI gets a
// real error rather than silently clamped values.
//
// Part of the settings/ split — see ../settings.ts for the public barrel.

import {
  AVATAR_FILENAME_RE,
  CHATTERBOX_VOICE_RE,
  DJ_PROMPT_LIMIT,
  DJ_PROMPT_NAME_MAX,
  DJ_PROMPT_TEXT_MAX,
  DJ_PROMPT_TEXT_MIN,
  FREQUENCIES,
  ID_RE,
  KOKORO_VOICE_RE,
  MOODS_LIMIT,
  MOOD_NAME_MAX,
  MOOD_PERIODS,
  MOOD_PROMPT_MAX,
  OVERRIDE_MAX_MINUTES,
  PERSONA_LIMIT,
  PIPER_VOICE_RE,
  POCKET_TTS_VOICE_RE,
  SCRIPT_LENGTHS,
  SHOW_MOODS,
  SKILLS_PER_PERSONA_LIMIT,
  SKILL_SLUG_RE,
  SOUL_MAX,
  ScheduleOverride,
  TTS_CLOUD_PROVIDERS,
  TTS_ENGINES,
  WEATHER_CONDITIONS,
  Webhook,
  clampTtsGain,
  clampTtsSpeed,
  emptyWeek,
  mintId,
  normalizeDial,
  normalizeMoodName,
} from './vocab.js';

import { minTrackSeconds } from './store.js';
import { webhooksSchema } from '../schemas/webhook.js';
import { mergeWebhookSecrets } from '../schemas/webhook-server.js';
import { showsSchema, type ShowSchemaContext } from '../schemas/show.js';
import { resolveShowIds } from '../schemas/show-server.js';
import { firstMessage } from '../util/zod-error.js';

// Strict validator for a `{engine, voice, cloudProvider}` voice slot. Shared by
// every persona's `tts` block AND the station-wide TTS fallback slot
// (`settings.tts.fallback`) — same shape, same per-engine voice rules, one
// implementation. `where` is the settings path prefix used in error messages,
// so a bad fallback voice reads `tts.fallback.voice must ...`.
export function validateTtsBlock(raw, where) {
  const t = raw || {};
  if (!TTS_ENGINES.includes(t.engine)) {
    throw new Error(`${where}.engine must be one of: ${TTS_ENGINES.join(', ')}`);
  }
  if (!TTS_CLOUD_PROVIDERS.includes(t.cloudProvider)) {
    throw new Error(`${where}.cloudProvider must be one of: ${TTS_CLOUD_PROVIDERS.join(', ')}`);
  }
  let voice = String(t.voice ?? '').trim();
  if (t.engine === 'kokoro') {
    if (!KOKORO_VOICE_RE.test(voice)) {
      throw new Error(
        `${where}.voice must match <lang><gender>_<name> for kokoro, e.g. bf_isabella`,
      );
    }
  } else if (t.engine === 'chatterbox') {
    // Empty = use built-in default voice. Otherwise the value must be a plain
    // .wav filename — no path separators — referencing a file the operator has
    // uploaded into config.chatterbox.voiceDir.
    if (voice && !CHATTERBOX_VOICE_RE.test(voice)) {
      throw new Error(
        `${where}.voice for chatterbox must be a .wav filename (no path), or empty for the default voice`,
      );
    }
  } else if (t.engine === 'pocket-tts') {
    // Two accepted forms (issue #213):
    //   - A built-in voice id (alba, anna, charles, …). Curated set lives in
    //     POCKET_TTS_VOICES; anything passing POCKET_TTS_VOICE_RE is also
    //     accepted (the worker falls back to the default for unknown ids).
    //   - A `.wav` filename in the shared voice folder → zero-shot cloning.
    //     Same shape as the chatterbox value.
    if (!voice) voice = 'alba';
    if (!POCKET_TTS_VOICE_RE.test(voice) && !CHATTERBOX_VOICE_RE.test(voice)) {
      throw new Error(
        `${where}.voice for pocket-tts must be a built-in voice id (e.g. alba) or a .wav filename`,
      );
    }
  } else if (t.engine === 'cloud') {
    // openai-compatible voices are server-specific; an empty voice lets the
    // server use its own default. openai/elevenlabs both require a voice id.
    if (t.cloudProvider === 'openai-compatible') {
      if (voice.length > 100) throw new Error(`${where}.voice must be 0-100 chars`);
    } else if (voice.length < 1 || voice.length > 100) {
      throw new Error(`${where}.voice must be 1-100 chars`);
    }
  } else if (t.engine === 'remote') {
    // Remote engine voices are server-specific — the sidecar interprets them
    // (built-in id, reference-wav filename, or VoiceDesign prompt). Empty is
    // valid: the sidecar picks its own default.
    if (voice.length > 100) throw new Error(`${where}.voice must be 0-100 chars`);
  } else {
    // piper: empty = use the baked-in default voice. Otherwise the value must
    // be an .onnx filename (no path separators) referencing a model the operator
    // dropped into the shared voice folder (issue #230). A Kokoro-shaped id is
    // also accepted: the seed roster carries a distinct Kokoro voice per persona
    // under the piper engine so switching to Kokoro yields different-sounding
    // DJs with no extra editing (see SEED_PERSONAS). resolvePiperVoice() falls
    // back to the default for it at render time, so it is harmless under piper
    // and must not block saving the shipped roster (issue #454).
    if (voice && !PIPER_VOICE_RE.test(voice) && !KOKORO_VOICE_RE.test(voice)) {
      throw new Error(
        `${where}.voice for piper must be an .onnx filename (no path), or empty for the default voice`,
      );
    }
  }
  return { engine: t.engine, cloudProvider: t.cloudProvider, voice, gainDb: clampTtsGain(t.gainDb), speed: clampTtsSpeed(t.speed) };
}

// Strict update-time path for the prompt-template library — any bad entry
// rejects the whole patch so the operator sees the error instead of silently
// losing a prompt.
export function validateDjPromptsStrict(raw) {
  if (!Array.isArray(raw) || raw.length > DJ_PROMPT_LIMIT) {
    throw new Error(`djPrompts must be an array of 0-${DJ_PROMPT_LIMIT} entries`);
  }
  const seen = new Set();
  return raw.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`djPrompts[${i}] must be an object`);
    const name = String(item.name ?? '').trim();
    if (name.length < 1 || name.length > DJ_PROMPT_NAME_MAX) {
      throw new Error(`djPrompts[${i}].name must be 1-${DJ_PROMPT_NAME_MAX} chars`);
    }
    const text = String(item.text ?? '').trim();
    if (text.length < DJ_PROMPT_TEXT_MIN || text.length > DJ_PROMPT_TEXT_MAX) {
      throw new Error(
        `djPrompts[${i}].text must be ${DJ_PROMPT_TEXT_MIN}-${DJ_PROMPT_TEXT_MAX} chars`,
      );
    }
    if (!text.includes('{name}')) {
      throw new Error(`djPrompts[${i}].text must contain the {name} placeholder`);
    }
    let id = typeof item.id === 'string' && ID_RE.test(item.id) ? item.id : mintId('dp_');
    if (seen.has(id)) id = mintId('dp_');
    seen.add(id);
    return { id, name, text };
  });
}

export function validatePersonasStrict(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > PERSONA_LIMIT) {
    throw new Error(`personas must be an array of 1-${PERSONA_LIMIT} entries`);
  }
  const seen = new Set();
  return raw.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`personas[${i}] must be an object`);
    const name = String(item.name ?? '').trim();
    if (name.length < 1 || name.length > 40)
      throw new Error(`personas[${i}].name must be 1-40 chars`);
    const soul = String(item.soul ?? '').trim();
    if (soul.length < 1 || soul.length > SOUL_MAX)
      throw new Error(`personas[${i}].soul must be 1-${SOUL_MAX} chars`);
    const tagline = String(item.tagline ?? '').trim();
    if (tagline.length > 80) throw new Error(`personas[${i}].tagline must be 0-80 chars`);
    // language — optional free text ("Turkish", "Türkçe", …). Absent/empty →
    // '' (English, no directive injected — the historical behaviour).
    let language = '';
    if (item.language !== undefined && item.language !== null) {
      if (typeof item.language !== 'string') {
        throw new Error(`personas[${i}].language must be a string`);
      }
      language = item.language.trim();
      if (language.length > 60) throw new Error(`personas[${i}].language must be 0-60 chars`);
    }
    if (!FREQUENCIES.includes(item.frequency)) {
      throw new Error(`personas[${i}].frequency must be one of: ${FREQUENCIES.join(', ')}`);
    }
    // scriptLength — optional. Absent → 'concise' (the default and the
    // historical behaviour); present must be a known value.
    let scriptLength = 'concise';
    if (item.scriptLength !== undefined && item.scriptLength !== null) {
      if (!SCRIPT_LENGTHS.includes(item.scriptLength)) {
        throw new Error(`personas[${i}].scriptLength must be one of: ${SCRIPT_LENGTHS.join(', ')}`);
      }
      scriptLength = item.scriptLength;
    }
    // djMode — optional boolean. Absent → false (a plain narrator persona, the
    // historical behaviour). When true the persona behaves like a working DJ
    // (forward-tease, callbacks, more presence) — see effectiveFrequency above.
    let djMode = false;
    if (item.djMode !== undefined && item.djMode !== null) {
      if (typeof item.djMode !== 'boolean') {
        throw new Error(`personas[${i}].djMode must be a boolean`);
      }
      djMode = item.djMode;
    }
    const tts = validateTtsBlock(item.tts, `personas[${i}].tts`);
    // skills — optional. Absent → null ("all skills", legacy/default). Present
    // → an explicit slug array (the UI always sends one once edited).
    let skills: string[] | null = null;
    if (item.skills !== undefined && item.skills !== null) {
      if (!Array.isArray(item.skills)) {
        throw new Error(`personas[${i}].skills must be an array of skill names`);
      }
      if (item.skills.length > SKILLS_PER_PERSONA_LIMIT) {
        throw new Error(
          `personas[${i}].skills must be at most ${SKILLS_PER_PERSONA_LIMIT} entries`,
        );
      }
      const seenSk = new Set<string>();
      skills = [];
      for (const s of item.skills) {
        const v = String(s ?? '').trim();
        if (!SKILL_SLUG_RE.test(v)) {
          throw new Error(`personas[${i}].skills entries must be slug strings`);
        }
        if (!seenSk.has(v)) {
          seenSk.add(v);
          skills.push(v);
        }
      }
    }
    let id = typeof item.id === 'string' && ID_RE.test(item.id) ? item.id : mintId('p_');
    if (seen.has(id)) id = mintId('p_');
    seen.add(id);
    // Avatar — optional. Absent/empty → '' (no avatar). Present must be a
    // bare basename matching AVATAR_FILENAME_RE. The dedicated upload route
    // is the only writer that creates the file on disk; this validator just
    // checks the persisted string. The post-patch sweep below garbage-
    // collects orphaned files when the persona itself is removed.
    let avatar = '';
    if (item.avatar !== undefined && item.avatar !== null && item.avatar !== '') {
      const a = String(item.avatar).trim();
      if (!AVATAR_FILENAME_RE.test(a)) {
        throw new Error(
          `personas[${i}].avatar must be a basename like <id>.png|jpg|jpeg|webp`,
        );
      }
      avatar = a;
    }
    return {
      id,
      name,
      tagline,
      frequency: item.frequency,
      scriptLength,
      djMode,
      humour: normalizeDial(item.humour),
      localColour: normalizeDial(item.localColour),
      warmth: normalizeDial(item.warmth),
      soul,
      language,
      avatar,
      tts,
      skills,
    };
  });
}

export function validateShowsStrict(raw, personas, allowedThemeIds: Set<string>, moodNames: string[] = SHOW_MOODS) {
  if (!Array.isArray(raw)) throw new Error('shows must be an array');
  // Note the legacy singular fields #929 replaced (mood / genre / …) are
  // refused by the SCHEMA, not here, so POST /shows and a backup restore get
  // the same answer. The lenient load path migrates them instead.
  const ctx: ShowSchemaContext = {
    personaIds: personas.map(p => p.id),
    moodNames,
    themeIds: [...allowedThemeIds],
    minTrackSeconds: minTrackSeconds(),
  };
  const parsed = showsSchema(ctx).safeParse(raw);
  if (!parsed.success) throw new Error(firstMessage(parsed.error, 'shows'));
  // The schema drops a themeId it doesn't recognise (see the comment on that
  // field). Reporting it is the caller's job, so the mirrored module stays
  // side-effect free — and an operator whose palette silently reverted to the
  // station default deserves the line in the log.
  parsed.data.forEach((show, i) => {
    const wanted = String((raw[i] as Record<string, unknown>)?.themeId ?? '').trim();
    if (wanted && !show.themeId) {
      console.warn(
        `[shows] dropping unknown themeId "${wanted}" from "${show.name}" — falling back to the station theme`,
      );
    }
  });
  return resolveShowIds(parsed.data);
}

export function validateScheduleStrict(raw, shows) {
  if (!raw || typeof raw !== 'object') throw new Error('schedule must be an object keyed 0-6');
  const showIds = shows.map(s => s.id);
  const week = emptyWeek();
  for (let d = 0; d < 7; d++) {
    const day = raw[d];
    if (day === undefined || day === null) continue;
    if (!Array.isArray(day) || day.length !== 24) {
      throw new Error(`schedule[${d}] must be an array of exactly 24 entries`);
    }
    for (let h = 0; h < 24; h++) {
      const v = day[h];
      if (v === null || v === undefined || v === '') {
        week[d][h] = null;
        continue;
      }
      if (typeof v !== 'string' || !showIds.includes(v)) {
        throw new Error(`schedule[${d}][${h}] references an unknown show`);
      }
      week[d][h] = v;
    }
  }
  return week;
}

// Strict takeover validator — used by update(). null clears; anything else
// must be a well-formed window over an existing show. The 12h cap is enforced
// here (not just the route) so no caller can persist an unbounded pin.
export function validateScheduleOverrideStrict(raw, shows): ScheduleOverride | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') throw new Error('scheduleOverride must be an object or null');
  const showId = typeof raw.showId === 'string' ? raw.showId : '';
  if (!shows.some(s => s.id === showId)) {
    throw new Error('scheduleOverride.showId references an unknown show');
  }
  const startedAt = raw.startedAt;
  const expiresAt = raw.expiresAt;
  if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt)) {
    throw new Error('scheduleOverride.startedAt/expiresAt must be epoch-ms numbers');
  }
  if (startedAt >= expiresAt) {
    throw new Error('scheduleOverride.expiresAt must be after startedAt');
  }
  if (expiresAt - startedAt > OVERRIDE_MAX_MINUTES * 60_000) {
    throw new Error(`scheduleOverride window must be at most ${OVERRIDE_MAX_MINUTES} minutes`);
  }
  return { showId, startedAt, expiresAt };
}

// Strict validator — used by update(). Shape and format now come from the
// shared schema (controller/src/schemas/webhook.ts), which the web form runs
// too; the stateful rules (redaction sentinel, id minting, cross-item dedupe)
// come from its server-only sibling. `existing` is the current list, so the
// operator can keep a previously-set authHeader by sending the redacted
// sentinel back unchanged.
//
// The failure path matters as much as the success path: update() is reached by
// callers that never touch POST /webhooks (backup restore, PUT /settings), and
// both do `res.status(400).json({ error: err.message })`. A raw ZodError's
// .message is a pretty-printed JSON array of issue objects, so safeParse +
// firstMessage is what keeps a bad restore reading as one readable line instead
// of a JSON blob in the operator's toast. Every remaining validate*Strict
// conversion should copy this shape.
export function validateWebhooksStrict(raw: unknown, existing: Webhook[] = []) {
  const r = webhooksSchema.safeParse(raw);
  // 'webhooks' is passed as the ROOT rather than string-prefixed here: this
  // schema is the bare array, so its issue paths start at the index, and
  // firstMessage needs to splice the name in FRONT of that index to produce
  // 'webhooks.0.url' rather than 'webhooks: 0.url'.
  if (!r.success) throw new Error(firstMessage(r.error, 'webhooks'));
  return mergeWebhookSecrets(r.data, existing);
}

// --- Strict update() validators for the mood system (the validateFestivalsStrict
// shape: whole-value replace, indexed throws, rebuilt objects strip unknown
// keys). `moodNames` is the effective vocabulary being saved, so a schedule /
// weather / festival entry may reference a mood added in the SAME patch. ---
// Exported for unit tests (scripts/moods.test.ts) — the pure validation/guard
// logic that keeps the mood system consistent on every save.
export function validateMoodsStrict(raw: any): Array<{ name: string; clapPrompt: string }> {
  if (!Array.isArray(raw)) throw new Error('moods must be an array');
  if (raw.length < 1) throw new Error('moods must have at least one entry');
  if (raw.length > MOODS_LIMIT) throw new Error(`moods must be at most ${MOODS_LIMIT} entries`);
  const seen = new Set<string>();
  return raw.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`moods[${i}] must be an object`);
    const name = normalizeMoodName(item.name);
    if (name.length < 1 || name.length > MOOD_NAME_MAX) {
      throw new Error(`moods[${i}].name must be 1-${MOOD_NAME_MAX} chars (letters, digits, dashes)`);
    }
    if (seen.has(name)) throw new Error(`moods[${i}].name "${name}" is a duplicate`);
    seen.add(name);
    const clapPrompt = typeof item.clapPrompt === 'string'
      ? item.clapPrompt.trim().slice(0, MOOD_PROMPT_MAX)
      : '';
    return { name, clapPrompt };
  });
}

export function validateMoodScheduleStrict(raw: any, moodNames: string[]): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('moodSchedule must be an object');
  }
  const names = new Set(moodNames);
  const out: Record<string, string> = {};
  for (const period of MOOD_PERIODS) {
    const v = String(raw[period] ?? '').trim();
    if (!names.has(v)) {
      throw new Error(`moodSchedule.${period} must be one of: ${moodNames.join(', ')}`);
    }
    out[period] = v;
  }
  return out;
}

export function validateWeatherMoodsStrict(raw: any, moodNames: string[]): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('weatherMoods must be an object');
  }
  const names = new Set(moodNames);
  const out: Record<string, string> = {};
  for (const cond of WEATHER_CONDITIONS) {
    const v = String(raw[cond] ?? '').trim();
    if (v && !names.has(v)) {
      throw new Error(`weatherMoods.${cond} must be a mood (${moodNames.join(', ')}) or empty`);
    }
    out[cond] = v;
  }
  return out;
}

// Reject a vocabulary edit that would orphan a mood still referenced by the
// festival calendar, either mood map, or a scheduled show. Renames are a
// two-step (add the new name, repoint the referrers, remove the old) — this is
// the guard that names exactly what still points at a removed mood.
export function assertNoOrphanMoods(next: any): void {
  const names = new Set<string>((next.moods || []).map((m: any) => m.name));
  const refs: string[] = [];
  for (const [period, mood] of Object.entries(next.moodSchedule || {})) {
    if (mood && !names.has(mood as string)) refs.push(`the ${period} time-of-day slot`);
  }
  for (const [cond, mood] of Object.entries(next.weatherMoods || {})) {
    if (mood && !names.has(mood as string)) refs.push(`the ${cond} weather slot`);
  }
  for (const f of next.festivals || []) {
    if (f.mood && !names.has(f.mood)) refs.push(`festival "${f.name}"`);
  }
  for (const s of next.shows || []) {
    for (const m of s.moods || []) {
      if (!names.has(m)) refs.push(`show "${s.name}"`);
    }
  }
  if (refs.length) {
    const uniq = [...new Set(refs)];
    throw new Error(`can't remove that mood — still used by ${uniq.join(', ')}. Reassign those first.`);
  }
}

const FESTIVALS_LIMIT = 50;

export function validateFestivalsStrict(raw, moodNames: string[] = SHOW_MOODS) {
  if (!Array.isArray(raw)) throw new Error('festivals must be an array');
  if (raw.length > FESTIVALS_LIMIT) {
    throw new Error(`festivals must be at most ${FESTIVALS_LIMIT} entries`);
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`festivals[${i}] must be an object`);
    const name = String(item.name ?? '').trim();
    if (name.length < 1 || name.length > 80) throw new Error(`festivals[${i}].name must be 1-80 chars`);
    const month = Number(item.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error(`festivals[${i}].month must be an integer 1-12`);
    }
    const day = Number(item.day);
    // Feb allows 29 — in common years a leap-day festival fires Mar 1
    // (Date.UTC rolls the date over in getFestivalContext).
    const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
      throw new Error(`festivals[${i}].day must be an integer 1-${daysInMonth} for month ${month}`);
    }
    const mood = String(item.mood ?? '').trim();
    if (!moodNames.includes(mood)) {
      throw new Error(`festivals[${i}].mood must be one of: ${moodNames.join(', ')}`);
    }
    const description = typeof item.description === 'string' ? item.description.trim().slice(0, 200) : '';
    const windowDays = Number(item.windowDays ?? 0);
    if (!Number.isInteger(windowDays) || windowDays < 0 || windowDays > 14) {
      throw new Error(`festivals[${i}].windowDays must be an integer 0-14`);
    }
    return { month, day, name, mood, description, windowDays };
  });
}

// Validate + persist. Returns { saved, requiresRestart } so the UI can react.

