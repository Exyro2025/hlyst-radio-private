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
import { bedsPatchSchema, jingleRatioSchema, sfxPatchSchema } from '../schemas/settings.js';
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
 * The converted keys. Everything else still lives in its hand-rolled branch.
 *
 * Adding an entry here is what moves a key onto the shared schema: update()'s
 * branch switches to parseSettingsPatchKey() and the route starts producing
 * `fieldErrors` for it, in one edit.
 */
export const SETTINGS_PATCH_SCHEMAS: Readonly<Partial<Record<SettingsPatchKey, ZodType>>> = {
  jingleRatio: jingleRatioSchema,
  sfx: sfxPatchSchema,
  beds: bedsPatchSchema,
};

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
 * The flat `error` string — the first issue's message, verbatim.
 *
 * INVARIANT: every message in SETTINGS_PATCH_SCHEMAS names its own dotted field
 * ('beds.thresholdSec must be number in [0, 60]'), so the message alone already
 * says where the problem is.
 *
 * This is the one place that does NOT go through `firstMessage`, and the
 * exception is narrow. firstMessage prefixes the issue path unconditionally
 * because zod's BUILT-IN messages name a constraint and never a location —
 * 'expected array, received string' is useless without 'webhooks.1.url' in
 * front. Every message here is custom and already carries the full path, so
 * prefixing yields 'crossSec: beds.crossSec must be number in [0, 15]'. Taking
 * the message as written keeps these strings byte-identical to the hand-rolled
 * branches they replace, which is the whole posture of the first slice.
 *
 * The path is not lost — it rides `fieldErrors`, which is where a form needs
 * it. The invariant is enforced in scripts/settings-patch-schema.test.ts, which
 * throws hostile values at every registered schema and fails any message that
 * doesn't name its key. `firstMessage` remains the fallback for an issue with
 * no message at all, so a future schema can't produce a bare 400.
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
export function parseSettingsPatchKey<T = unknown>(key: SettingsPatchKey, value: unknown): T {
  const schema = SETTINGS_PATCH_SCHEMAS[key];
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
    const schema = SETTINGS_PATCH_SCHEMAS[key];
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
