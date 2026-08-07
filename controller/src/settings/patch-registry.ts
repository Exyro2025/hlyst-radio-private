// The `POST /settings` patch registry (#1348).
//
// `settings.update()` takes a PARTIAL patch over 42 top-level keys and validates
// it in a ~1,100-line chain of `if ('<key>' in patch)` branches. #1337 put every
// single-feature admin form on a shared zod schema and deliberately held this
// one back, because a route that owns forty-two shapes doesn't fit the recipe.
//
// This module is the frame the conversion lands in, one key at a time:
//
//   SETTINGS_PATCH_KEYS     every top-level key update() will act on
//   SETTINGS_PATCH_SCHEMAS  the subset converted to a shared schema so far
//   parseSettingsPatchKey() the strict posture — used INSIDE update()
//   validateSettingsPatch() the route posture — supplies `fieldErrors`
//
// Both postures run the SAME schema; only the consequence differs, which is
// #1337's rule. An unconverted key keeps its hand-rolled branch untouched and
// simply has no entry here, so the frame can land without a flag day.
//
// WHY UNKNOWN-KEY REJECTION IS A ROUTE POSTURE AND NEVER AN update() RULE
// ----------------------------------------------------------------------
// The issue asks for unknown top-level keys to be rejected rather than silently
// dropped, and at the route that is right: every admin panel posts keys from
// this inventory, so an unknown one is a typo that today saves nothing and
// still answers 200.
//
// Inside update() the same rule would be a data-loss bug. routes/backup.ts:218
// parses a backup's settings.json and hands the WHOLE object to update(); so
// does onboarding, and so does every internal caller. A backup written by a
// newer version carries keys this one has never heard of, and refusing the
// patch would turn "one setting didn't come across" into "the restore failed".
// Hence: the inventory is enforced at the boundary the operator types at, and
// update() stays tolerant of keys it doesn't know.
import { ZodError, type ZodType } from 'zod';
import {
  archivePatchSchema,
  audioPatchSchema,
  bedsPatchSchema,
  crossfadeDurationSchema,
  djHouseRulesSchema,
  festivalsSchema,
  jingleRatioSchema,
  likesPatchSchema,
  localeSchema,
  loudnessPatchSchema,
  moodScheduleSchema,
  moodsSchema,
  scrobblePatchSchema,
  searchPatchSchema,
  sfxPatchSchema,
  stationDescriptionSchema,
  stationSchema,
  streamPatchSchema,
  transitionsPatchSchema,
  uiPatchSchema,
  weatherMoodsSchema,
  weatherPatchSchema,
  webhooksPolicyPatchSchema,
} from '../schemas/settings.js';
import { firstMessage, flattenIssues } from '../util/zod-error.js';

/**
 * Every top-level key `settings.update()` acts on, in the order its branches
 * run.
 *
 * Order is not decoration. update() applies moods before the orphan guard and
 * personas before shows before schedule, because each validates against what
 * the last one wrote. Iterating in branch order means the route reports the
 * SAME first failure update() would have thrown on, rather than a second
 * opinion that depends on JSON key order.
 *
 * `maxTrackMinutes` is the legacy alias `rawMaxTrackSec()` still reads, and
 * `stationDescription` is its own branch rather than part of `station` — both
 * are postable today and both were missing from the issue's inventory. A key
 * absent from this list is rejected at the route, so adding a settings key
 * means adding it here as well as the three edits in controller/CLAUDE.md.
 */
export const SETTINGS_PATCH_KEYS = [
  'jingleRatio',
  'crossfadeDuration',
  'maxTrackSeconds',
  'maxTrackMinutes',
  'archive',
  'stream',
  'loudness',
  'weather',
  'station',
  'stationDescription',
  'timezone',
  'locale',
  'theme',
  'moods',
  'moodSchedule',
  'weatherMoods',
  'festivals',
  'djPrompts',
  'activeDjPromptId',
  'djPrompt',
  'djHouseRules',
  'personas',
  'shows',
  'schedule',
  'scheduleOverride',
  'activePersonaId',
  'tts',
  'llm',
  'search',
  'embedding',
  'skills',
  'audio',
  'transitions',
  'sfx',
  'beds',
  'ui',
  'privacy',
  'requests',
  'webhooks',
  'webhooksPolicy',
  'scrobble',
  'likes',
] as const;

export type SettingsPatchKey = (typeof SETTINGS_PATCH_KEYS)[number];

const SETTINGS_PATCH_KEY_SET: ReadonlySet<string> = new Set(SETTINGS_PATCH_KEYS);

/**
 * The context a factory-shaped entry validates against.
 *
 * Every field is nullable and null always means "this caller cannot check that
 * rule" — the convention ShowSchemaContext established. It travels as ONE value
 * and is never unpacked into per-field arguments, for the reason PickerScope
 * documents: a rule named in one list and forgotten in another silently stops
 * being enforced on one path while the other still applies it.
 */
export interface SettingsPatchContext {
  /** The EFFECTIVE mood vocabulary — the same-patch one when `moods` is in the
   *  body. The route cannot know it (that is update()'s ordering to resolve),
   *  so it passes null and checks shape only. */
  moodNames: string[] | null;
}

export const SETTINGS_PATCH_SHAPE_ONLY: SettingsPatchContext = { moodNames: null };

type SettingsPatchEntry = ZodType | ((ctx: SettingsPatchContext) => ZodType);

/**
 * The converted keys. Everything else still lives in its hand-rolled branch.
 *
 * Adding an entry here is what moves a key onto the shared schema: update()'s
 * branch switches to parseSettingsPatchKey() and the route starts producing
 * `fieldErrors` for it, in one edit.
 *
 * An entry is either a plain schema or a FACTORY over SettingsPatchContext,
 * for the shapes that cannot be validated against themselves.
 */
export const SETTINGS_PATCH_SCHEMAS: Readonly<Partial<Record<SettingsPatchKey, SettingsPatchEntry>>> = {
  jingleRatio: jingleRatioSchema,
  crossfadeDuration: crossfadeDurationSchema,
  archive: archivePatchSchema,
  stream: streamPatchSchema,
  loudness: loudnessPatchSchema,
  weather: weatherPatchSchema,
  station: stationSchema,
  stationDescription: stationDescriptionSchema,
  locale: localeSchema,
  djHouseRules: djHouseRulesSchema,
  search: searchPatchSchema,
  audio: audioPatchSchema,
  transitions: transitionsPatchSchema,
  sfx: sfxPatchSchema,
  beds: bedsPatchSchema,
  ui: uiPatchSchema,
  webhooksPolicy: webhooksPolicyPatchSchema,
  scrobble: scrobblePatchSchema,
  likes: likesPatchSchema,
  moods: moodsSchema,
  moodSchedule: moodScheduleSchema,
  weatherMoods: weatherMoodsSchema,
  festivals: festivalsSchema,
};

/** Resolve an entry against a context — a plain schema ignores it. */
function schemaFor(key: SettingsPatchKey, ctx: SettingsPatchContext): ZodType | undefined {
  const entry = SETTINGS_PATCH_SCHEMAS[key];
  if (!entry) return undefined;
  return typeof entry === 'function' ? entry(ctx) : entry;
}

/**
 * Dotted paths for `fieldErrors`, rooted at the settings key.
 *
 * A block schema reports `thresholdSec`; the form input is `beds.thresholdSec`,
 * which is also react-hook-form's setError syntax. A scalar key's issue has an
 * empty path, so it maps to the bare key.
 */
function prefixed(key: string, issues: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const [path, message] of Object.entries(issues)) {
    out[path ? `${key}.${path}` : key] = message;
  }
  return out;
}

/**
 * The flat `error` string — the first issue's message, VERBATIM.
 *
 * INVARIANT: every message in SETTINGS_PATCH_SCHEMAS is the exact string its
 * hand-rolled branch threw, and is written to stand alone.
 *
 * This is the one place that does NOT go through `firstMessage`, and the
 * exception is narrow. firstMessage prefixes the issue path unconditionally
 * because zod's BUILT-IN messages name a constraint and never a location —
 * 'expected array, received string' is useless without 'webhooks.1.url' in
 * front. Every message here is custom and already self-locating, so prefixing
 * would produce 'crossSec: beds.crossSec must be number in [0, 15]'. Carrying
 * the message as written keeps these strings byte-identical to the branches
 * they replace, which operators have been reading in toasts for as long as the
 * keys have existed.
 *
 * Most of them name a dotted field ('beds.thresholdSec must be …') but NOT all:
 * 'station name must be 80 chars or fewer', 'search.baseUrl too long' and
 * "locale must be 'en-GB' or 'en-US'" are all shipping strings that don't fit
 * that mould. The enforced rule is therefore the weaker, true one — a message
 * must be non-empty, single-line, and must not be one of zod's built-ins —
 * checked structurally in scripts/settings-patch-schema.test.ts by throwing
 * hostile values at every registered schema. The dotted path is never lost: it
 * rides `fieldErrors`, which is where a form needs it anyway.
 *
 * `firstMessage` remains the fallback for an issue carrying no message at all,
 * so a future schema cannot produce a bare 400.
 */
function flatten(err: ZodError): string {
  return err.issues[0]?.message || firstMessage(err);
}

/**
 * Strict posture — parse ONE key's value, or throw a plain Error.
 *
 * Used inside update(), which answers `{ error: err.message }`. A raw ZodError
 * must never reach that: its `.message` is a pretty-printed JSON array, ~15
 * lines of it, and update() is reached by backup restore and PUT /settings
 * alike.
 *
 * A key with no schema yet is returned untouched, so a caller can route every
 * key through here as the conversion proceeds.
 */
export function parseSettingsPatchKey<T = unknown>(
  key: SettingsPatchKey,
  value: unknown,
  ctx: SettingsPatchContext = SETTINGS_PATCH_SHAPE_ONLY,
): T {
  const schema = schemaFor(key, ctx);
  if (!schema) return value as T;
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(flatten(r.error));
  return r.data as T;
}

export interface SettingsPatchFailure {
  error: string;
  fieldErrors: Record<string, string>;
}

/**
 * Route posture — validate a whole patch, reporting every failure at once.
 *
 * Returns null when the patch is acceptable. Note it validates and does NOT
 * rewrite the body: update() re-runs the same schemas as it applies each key,
 * and it is still the authoritative chokepoint. Coercion is pure, so running it
 * twice costs nothing and leaves exactly one place that decides what gets
 * stored.
 *
 * Unknown keys are collected rather than short-circuited — an operator who
 * mistyped two keys should learn both.
 */
export function validateSettingsPatch(patch: unknown): SettingsPatchFailure | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { error: 'settings patch must be an object', fieldErrors: {} };
  }
  const body = patch as Record<string, unknown>;
  const unknown = Object.keys(body).filter((k) => !SETTINGS_PATCH_KEY_SET.has(k));
  if (unknown.length) {
    const fieldErrors: Record<string, string> = Object.create(null);
    for (const k of unknown) fieldErrors[k] = 'not a settings key';
    return {
      error: `unknown settings key${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`,
      fieldErrors,
    };
  }

  let error = '';
  let fieldErrors: Record<string, string> = Object.create(null);
  for (const key of SETTINGS_PATCH_KEYS) {
    if (!(key in body)) continue;
    // SHAPE-ONLY at the route for factory entries. The effective mood
    // vocabulary depends on whether `moods` rides in the same body and on what
    // validating it produced — update()'s ordering to resolve, not the
    // middleware's. Same three-posture split PUT /schedule already uses.
    const schema = schemaFor(key, SETTINGS_PATCH_SHAPE_ONLY);
    if (!schema) continue;
    const r = schema.safeParse(body[key]);
    if (r.success) continue;
    // First failure in BRANCH order owns the flat string, so the route and
    // update() agree on which problem to name.
    if (!error) error = flatten(r.error);
    fieldErrors = { ...fieldErrors, ...prefixed(key, flattenIssues(r.error)) };
  }
  return error ? { error, fieldErrors } : null;
}
