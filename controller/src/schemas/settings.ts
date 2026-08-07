// Shared schemas for individual `POST /settings` patch keys — the first slice
// of the mega-endpoint conversion (#1348, split out of #1337).
//
// HARD RULE: this file may import ONLY from 'zod'. It is copied verbatim into
// the web bundle, so a project import or a node builtin here breaks the mirror.
// Enforced by controller/eslint.config.mjs and by gen-schemas.ts.
//
// WHY A KEY AT A TIME, AND NOT ONE SCHEMA FOR THE SETTINGS OBJECT
// ---------------------------------------------------------------
// The `/settings` body is a partial PATCH, not an object: every admin panel
// posts only the keys it owns. `z.object` strips unknown keys, so a schema over
// the whole settings object would silently delete whatever a form learns to
// send next. Instead each top-level key owns its own schema here, and
// settings/patch-registry.ts runs only the keys a given patch actually carries.
// That keeps the stripping scoped to a block whose shape is fully known.
//
// FIDELITY IS THE POINT OF THE FIRST SLICE
// ----------------------------------------
// #1337's rule is that no conversion may introduce a silent repair where the
// operator previously got a refusal, or vice versa. The hand-rolled branches
// these replace carry a lot of ACCIDENTAL leniency, and reproducing it is most
// of the work here:
//
//   * `parseInt(raw, 10)` / `parseFloat(raw)` stringify first, so '5' and even
//     '5abc' parse, and a float handed to an int key TRUNCATES rather than
//     failing (jingleRatio: 5.7 saves as 5 today). `z.number().int()` refuses
//     all three. See settingsIntLike / settingsFloatLike.
//   * `!!value` accepts anything, so `enabled: 1` is `true` today. `z.boolean()`
//     refuses it. See settingsBoolLike.
//   * `patch.beds || {}` means a non-object block is a silent no-op, not an
//     error. See settingsBlockOf.
//
// Each of those is defensible to TIGHTEN — webhooks did exactly that in #1337 —
// but tightening is a behaviour change and belongs in a PR that says so. This
// one establishes the frame at zero behaviour change, so the frame itself can't
// be what hides a regression.
//
// The bounds live HERE rather than in settings/defaults.ts's BOUNDS because a
// mirrored module may not import a non-mirrored one, and the browser needs the
// same numbers to pre-flight the form. BOUNDS re-exports these — the same
// "first feature converted owns the constant" rule that put SHOW_ID_RE in
// schemas/show.ts. The web side must read them from the mirror rather than
// hand-copying, which is what BedsSection did with a bare `60` and `15`.
import { z } from 'zod';

// Every top-level name in schemas/*.ts shares ONE scope in the flat mirror
// (module-private ones included), hence the SETTINGS_/settings prefixes.
export interface SettingsNumericBound {
  min: number;
  max: number;
}

// 0 = jingles off entirely — radio.liq skips the jingle rotate when the ratio
// file reads 0 (issue #997).
export const JINGLE_RATIO_BOUNDS: SettingsNumericBound = { min: 0, max: 1000 };

// 0 = bed every link whose incoming vocal onset is unknown. The ceiling is
// deliberately low: past ~60s the DJ has outlasted any script the generators
// produce, so a higher value is indistinguishable from beds being off.
export const BEDS_THRESHOLD_SEC_BOUNDS: SettingsNumericBound = { min: 0, max: 60 };

// The bed's ramp into the next song. bed-policy clamps this against the bed's
// own length too, so a long ramp on a short link can't invert the arithmetic.
export const BEDS_CROSS_SEC_BOUNDS: SettingsNumericBound = { min: 0, max: 15 };

/**
 * `parseInt(raw, 10)` + a bounds check, exactly as the hand-rolled branch did.
 *
 * The parse is deliberately NOT `z.coerce.number().int()`. parseInt stringifies
 * its argument and reads a LEADING integer, so it accepts the string forms an
 * older admin build still posts and truncates a float instead of refusing it.
 * Swapping in a strict numeric schema turns three silent repairs into refusals
 * at once, which is the failure #1337 rules out.
 *
 * `message` names its own field because it is also the flat `error` string the
 * operator's toast shows, and those strings are unchanged from the branches
 * this replaces. patch-registry.ts is what supplies the dotted path for
 * `fieldErrors`, so the location is never lost.
 */
export function settingsIntLike(bounds: SettingsNumericBound, message: string) {
  return z
    .unknown()
    .superRefine((raw, ctx) => {
      const v = parseInt(raw as string, 10);
      if (!Number.isFinite(v) || v < bounds.min || v > bounds.max) {
        ctx.addIssue({ code: 'custom', message });
      }
    })
    .transform((raw) => parseInt(raw as string, 10));
}

/** `parseFloat(raw)` + a bounds check. Same rationale as settingsIntLike. */
export function settingsFloatLike(bounds: SettingsNumericBound, message: string) {
  return z
    .unknown()
    .superRefine((raw, ctx) => {
      const v = parseFloat(raw as string);
      if (!Number.isFinite(v) || v < bounds.min || v > bounds.max) {
        ctx.addIssue({ code: 'custom', message });
      }
    })
    .transform((raw) => parseFloat(raw as string));
}

/**
 * `!!value` — accepts anything, like the branches this replaces.
 *
 * Not `z.boolean()`. These keys are reached by backup restore, which posts a
 * whole (possibly hand-edited) settings.json straight to update(); a truthy
 * non-boolean that saves today would begin failing the entire restore.
 */
export function settingsBoolLike() {
  return z.unknown().transform((v) => !!v);
}

/**
 * A settings BLOCK — `{ enabled?, … }` — with the branches' own leniency:
 *
 *  - a non-object (or null) block is an empty patch, not an error, because
 *    `patch.beds || {}` followed by `bd.x !== undefined` no-ops on anything
 *    that isn't an object;
 *  - an explicitly-undefined field is absent, matching `!== undefined`;
 *  - unknown fields inside the block are dropped rather than refused. Only the
 *    TOP-level key inventory rejects unknowns (see patch-registry.ts), and for
 *    the same reason it is a route-only posture: a backup written by a newer
 *    version carries block fields this one has never heard of, and restore must
 *    not die on them.
 */
export function settingsBlockOf<T extends z.ZodRawShape>(shape: T) {
  return z.preprocess((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }, z.object(shape).partial());
}

// --- the converted keys ----------------------------------------------------

// How many tracks play between jingles. Needs a mixer restart, which update()
// still decides — a schema says what a value may BE, never what applying it
// costs.
export const jingleRatioSchema = settingsIntLike(
  JINGLE_RATIO_BOUNDS,
  `jingleRatio must be int in [${JINGLE_RATIO_BOUNDS.min}, ${JINGLE_RATIO_BOUNDS.max}]`,
);

export const sfxPatchSchema = settingsBlockOf({
  enabled: settingsBoolLike(),
});

export const bedsPatchSchema = settingsBlockOf({
  enabled: settingsBoolLike(),
  thresholdSec: settingsFloatLike(
    BEDS_THRESHOLD_SEC_BOUNDS,
    `beds.thresholdSec must be number in [${BEDS_THRESHOLD_SEC_BOUNDS.min}, ${BEDS_THRESHOLD_SEC_BOUNDS.max}]`,
  ),
  crossSec: settingsFloatLike(
    BEDS_CROSS_SEC_BOUNDS,
    `beds.crossSec must be number in [${BEDS_CROSS_SEC_BOUNDS.min}, ${BEDS_CROSS_SEC_BOUNDS.max}]`,
  ),
});
