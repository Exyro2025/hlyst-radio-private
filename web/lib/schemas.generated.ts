// GENERATED FILE — do not edit by hand.
// Mirror of controller/src/schemas/*.ts. Regenerate with:
//   cd controller && npm run gen:schemas
// CI fails if this drifts from the controller schemas.
//
// These are the SAME schemas the controller enforces. The form resolver and the
// route middleware therefore cannot disagree.

import { z } from 'zod';

// ─── from controller/src/schemas/imaging.ts ──────────────────────────────

// Shared imaging schemas — the station's produced audio assets. Sound effects,
// beds, jingles and clone voices are four tabs and four routes, but ONE
// contract wearing four hats: a name, a description, a prompt (or jingle
// text), a duration. It was written out four times in the routes and four more
// in the panels; defining it once here is what makes them provably the same
// rule. Executed on BOTH sides: the controller runs these at the route
// boundary (middleware/validate.ts), the browser reads the caps and duration
// bands out of the mirror (web/lib/schemas.generated.ts) so an input can no
// longer invite a request the route rejects.
//
// HARD RULE: this file may import ONLY from 'zod'. It is copied verbatim into
// the web bundle. Enforced by controller/eslint.config.mjs and gen-schemas.ts.
//
// Only the duration BANDS genuinely differ between kinds, so those stay named
// per kind — broadcast/sfx.ts, broadcast/beds.ts and audio/bed-gen.ts
// re-export them rather than declaring their own. The old drift was exactly
// here: the sfx duration input carried min 0.5 / max 22 (the ElevenLabs
// generator's own range) while the route capped at 10.

// The caps 60 and 200 existed only as maxLength attributes on the admin
// inputs; the controller had NO rule at all, so an API caller could store a
// name the library list then had to render. Lifting them into the schema is a
// real tightening.
export const IMAGING_NAME_MAX = 60;
export const IMAGING_DESCRIPTION_MAX = 200;
export const IMAGING_PROMPT_MAX = 500;
export const JINGLE_TEXT_MAX = 500;

// Sound effects sit under a spoken line, so they cap well below the
// generator's own 22s ceiling; the 0.5 floor is the ElevenLabs sound-gen
// minimum. broadcast/sfx.ts re-exports the max as MAX_DURATION_SEC.
export const SFX_MIN_SEC = 0.5;
export const SFX_MAX_SEC = 10;
// A bed must outlast the script read over it; generation via the ElevenLabs
// Music API caps at 2 minutes. broadcast/beds.ts re-exports the min as
// MIN_DURATION_SEC, audio/bed-gen.ts the max as BED_GEN_MAX_SEC.
export const BED_MIN_SEC = 30;
export const BED_GEN_MAX_SEC = 120;

// Explicit null reads as absent, as the `(req.body?.x || '')` readers these
// replace always did. (Named per-module: the mirror is one flat file.)
const imagingNullToUndefined = (v: unknown) => (v == null ? undefined : v);

const imagingName = z.preprocess(
  imagingNullToUndefined,
  z
    .string({ error: 'name is required' })
    .trim()
    .min(1, 'name is required')
    .max(IMAGING_NAME_MAX, `name must be 1-${IMAGING_NAME_MAX} chars`),
);

// NOTE: `.optional()` with a `.max()` and no `.catch()` — a catch cannot tell
// a wrong type from a too-long value, so it would silently blank a description
// the operator wrote 300 characters into. Refusing is the point.
const imagingDescription = z.preprocess(
  imagingNullToUndefined,
  z
    .string({ error: 'must be text' })
    .trim()
    .max(IMAGING_DESCRIPTION_MAX, `must be 0-${IMAGING_DESCRIPTION_MAX} chars`)
    .default(''),
);

// A duration knob: absent / '' means "let the generator decide"; a numeric
// string is what an <input type="number"> posts. The band is per kind.
function imagingDuration(band: { min: number; max: number }) {
  return z.preprocess(
    imagingNullToUndefined,
    z
      .union([z.literal(''), z.number(), z.string()])
      .optional()
      .transform((v) => (v === undefined || v === '' ? undefined : Number(v)))
      .refine((d) => d === undefined || (Number.isFinite(d) && d > 0), 'must be a positive number')
      .refine(
        (d) => d === undefined || d >= band.min,
        `must be at least ${band.min}s`,
      )
      .refine(
        (d) => d === undefined || d <= band.max,
        `is capped at ${band.max}s`,
      ),
  );
}

// POST /sfx — generate a stinger from a prompt.
export const sfxCreateSchema = z.object({
  name: imagingName,
  description: imagingDescription,
  prompt: z
    .string({ error: 'prompt is required' })
    .trim()
    .min(1, 'prompt is required')
    .max(IMAGING_PROMPT_MAX, `prompt too long (max ${IMAGING_PROMPT_MAX})`),
  durationSec: imagingDuration({ min: SFX_MIN_SEC, max: SFX_MAX_SEC }),
});

// POST /beds — generate an instrumental bed from a prompt.
export const bedCreateSchema = z.object({
  name: imagingName,
  description: imagingDescription,
  prompt: z
    .string({ error: 'prompt is required' })
    .trim()
    .min(1, 'prompt is required')
    .max(IMAGING_PROMPT_MAX, `prompt too long (max ${IMAGING_PROMPT_MAX})`),
  durationSec: imagingDuration({ min: BED_MIN_SEC, max: BED_GEN_MAX_SEC }),
});

// POST /jingles — render a TTS stinger from text.
export const jingleCreateSchema = z.object({
  text: z
    .string({ error: 'text is required' })
    .trim()
    .min(1, 'text is required')
    .max(JINGLE_TEXT_MAX, `text too long (max ${JINGLE_TEXT_MAX})`),
});

// The multipart import bodies. These sit AFTER audioUpload in the route chain:
// multer is what parses a multipart body into req.body in the first place, and
// validateBody replaces req.body ONLY — req.file, which no schema describes,
// rides through untouched. (The mirror image of the skills open-tail rule:
// there the extra data was IN the body and a schema would have eaten it; here
// it is beside the body and the schema cannot reach it.)
export const imagingImportSchema = z.object({
  name: imagingName,
  description: imagingDescription,
});

// A jingle import's label is optional — an absent label falls back to the
// filename server-side.
export const jingleImportSchema = z.object({
  label: z.preprocess(
    imagingNullToUndefined,
    z
      .string({ error: 'must be text' })
      .trim()
      .max(IMAGING_DESCRIPTION_MAX, `must be 0-${IMAGING_DESCRIPTION_MAX} chars`)
      .optional()
      .transform((v) => v || undefined),
  ),
});

// A clone-voice import has no description: the folder deliberately keeps no
// JSON sidecar (it stays operator-writable by hand), so there is nowhere for
// one to live.
export const voiceImportSchema = z.object({
  name: imagingName,
});

// ─── from controller/src/schemas/onboarding.ts ───────────────────────────

// Shared onboarding schemas — the two PROBE bodies and the handful of rules
// the save handler had to hand-roll BECAUSE settings.update() does not own
// them. Executed on BOTH sides: the controller runs them at the route boundary
// and inside /onboarding/save; the browser (web/components/onboarding) runs the
// mirrored copy so a rule can hold a button shut instead of only answering a
// pressed one.
//
// HARD RULE: this file may import ONLY from 'zod'. It is copied verbatim into
// the web bundle. Enforced by controller/eslint.config.mjs and gen-schemas.ts.
//
// What is deliberately NOT here: the settings pass-through. Most of
// POST /onboarding/save forwards partial llm / tts / personas / weather
// patches to settings.update(), and a schema in front of that is the /settings
// mega-endpoint problem in miniature — worse than nothing, because z.object
// would strip whatever the wizard learns to send next. Converted is only what
// the ROUTE owns.

/**
 * One normalisation for Navidrome credentials, everywhere they travel: trim,
 * and strip trailing slashes off the url — `${url}/rest/ping` against a stored
 * `…:4533/` double-slashes and some proxies 404 it. The PROBE requires all
 * three fields; save must NOT (skipping Navidrome is a supported way through
 * the wizard, and the shell posts the block with empty strings) — so the
 * strict schema below and this lenient helper share the normalisation rather
 * than each stating their own.
 */
export function normalizeNavidromeCredentials(raw: unknown): {
  url: string;
  user: string;
  pass: string;
} {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    url: String(r.url ?? '').trim().replace(/\/+$/, ''),
    user: String(r.user ?? '').trim(),
    pass: String(r.pass ?? ''),
  };
}

// POST /onboarding/test-navidrome — the probe needs something to probe.
export const navidromeProbeSchema = z
  .unknown()
  .transform(normalizeNavidromeCredentials)
  .refine(
    (c) => Boolean(c.url && c.user && c.pass),
    'url, user, and pass are required',
  );

// POST /onboarding/test-llm. The openai-compatible rule used to be a `throw`
// inside the probe's provider switch, so the only way to discover it was to
// press Test and wait — in the schema it also holds the wizard's button shut.
export const llmProbeSchema = z
  .unknown()
  .transform((raw) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      provider: String(r.provider ?? '').trim(),
      model: String(r.model ?? '').trim(),
      apiKey: String(r.apiKey ?? '').trim(),
      baseUrl: String(r.baseUrl ?? '').trim(),
      ollamaUrl: String(r.ollamaUrl ?? '').trim(),
    };
  })
  .refine((c) => Boolean(c.provider && c.model), 'provider and model are required')
  .refine(
    (c) => c.provider !== 'openai-compatible' || Boolean(c.baseUrl),
    'baseUrl is required for openai-compatible',
  );
export type LlmProbeInput = z.output<typeof llmProbeSchema>;

/**
 * Fish Audio's provider-specific save rule: a message, or null when fine.
 *
 * Deliberately NOT a schema over the tts patch — a schema that has to strip
 * nothing is the wrong tool when the object belongs to settings.update(); this
 * helper inspects one nested block without claiming ownership of the object
 * around it. It is the ONE copy: the route ran `1-100` while the wizard ran
 * `1–100` — same logic, drifted message, which is what the drift looks like
 * *before* it becomes a bug.
 */
export function fishAudioIssue(cloud: unknown): string | null {
  const c = (cloud && typeof cloud === 'object' ? cloud : {}) as Record<string, unknown>;
  if (c.enabled !== true || c.provider !== 'fish-audio') return null;
  const bad = (v: unknown) => {
    const s = String(v ?? '').trim();
    return !s || s.length > 100 || /[\r\n]/.test(s);
  };
  if (bad(c.model)) return 'Fish Audio model id must be 1-100 characters with no line breaks';
  if (bad(c.voice)) return 'Fish Audio voice reference id must be 1-100 characters with no line breaks';
  return null;
}

// ─── from controller/src/schemas/playlist.ts ─────────────────────────────

// Shared playlist schemas — the request bodies of the /playlists routes and
// the recipe shape behind sync-enabled playlists, executed on BOTH sides. The
// controller runs them at the route boundary (middleware/validate.ts) and in
// the recipe store's lenient read; the browser runs the mirrored copy
// (web/lib/schemas.generated.ts) for the builder's Generate/Save gates.
//
// HARD RULE: this file may import ONLY from 'zod'. It is copied verbatim into
// the web bundle. Enforced by controller/eslint.config.mjs and gen-schemas.ts.
//
// THE STRICT/LENIENT SPLIT LIVES INSIDE THIS MODULE. Playlists have no
// settings.update() chokepoint and no validate*Strict/normalize* pair, so the
// two postures are expressed here directly: **the knobs never throw, the
// request wrappers do.** A knob is a preference the engine has always clamped
// (targetCount) or ignored (a garbage mood), so failing a body over one would
// be a regression for anyone driving the API — and the same knob/recipe shape
// is run by the recipe-store read, where a throw wedges sync on boot. What
// rejects is the operator's input being WRONG: a save with no name, an append
// with no ids, a patch that changes nothing, a generate with nothing to
// generate from.

// The one cap a playlist name gets. It exists so an API caller can't store a
// name the library list then has to render; the save modal's input runs the
// same rule as an inline error rather than a silent maxLength truncation.
export const PLAYLIST_NAME_MAX = 120;

// Explicit null reads as absent — the hand-rolled readers these replace used
// `typeof v === 'string' ? v : undefined`, so null has always meant "not set".
// (Named per-module: the mirror is one flat file.)
const playlistText = z.unknown().optional().transform((v) => (typeof v === 'string' ? v : undefined));

// A trimmed id list. NEVER throws: a non-array reads as empty (the old
// parseIds behaviour), non-string entries are dropped. Deliberately UNCAPPED —
// the builder's deck can hold a playlist LOADED from Navidrome, and refusing
// to re-save what the server already holds would be a new failure the
// hand-rolled reader never had.
const playlistIdList = z.unknown().optional().transform((v): string[] => {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
    .map((x) => x.trim());
});

// Knobs and sources pass through as-is (object → itself, anything else → {}).
// Two deliberate non-rules:
//   - No `.default()` on targetCount (or any knob): playlist-gen reads
//     `targetCount ?? (targetMinutes ? … : DEFAULT)`, so a schema default here
//     would silently retire targetMinutes.
//   - `energies` is NOT validated against SHOW_ENERGY: a mirrored module may
//     not import another mirrored module, and re-declaring the tuple would be
//     the exact drift this conversion removes — so the values stay free text
//     here (the engine ignores unknown ones) and the WEB reads SHOW_ENERGY out
//     of the flat mirror for its chips.
const playlistLooseRecord = z.unknown().optional().transform((v): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}));

// Non-object bodies read as {} so the wrappers' own refusals (not a type
// error) answer an empty POST.
const playlistBody = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/**
 * "Is there anything to generate FROM?" — the ONE intent rule, shared by the
 * generate schema's refinement below AND the builder's Generate button (which
 * needs the answer before a request exists, so a refinement alone could not
 * retire the hand copy). The two copies it replaces had already diverged: the
 * route counted `knobs.eras?.length`, so an era window with both ends open was
 * intent server-side and not client-side. The unified rule: a window counts
 * only when it carries at least one real bound.
 */
export function playlistHasIntent(input: {
  prompt?: unknown;
  seedTrackIds?: unknown;
  seedArtist?: unknown;
  knobs?: unknown;
  sources?: unknown;
}): boolean {
  const knobs = (input?.knobs && typeof input.knobs === 'object'
    ? input.knobs
    : {}) as Record<string, unknown>;
  const sources = (input?.sources && typeof input.sources === 'object'
    ? input.sources
    : {}) as Record<string, unknown>;
  const filled = (v: unknown) => Array.isArray(v) && v.length > 0;
  const erasWithBounds = Array.isArray(knobs.eras)
    && knobs.eras.some((w) => {
      const win = w as { fromYear?: unknown; toYear?: unknown } | null;
      return win && typeof win === 'object' && (win.fromYear != null || win.toYear != null);
    });
  return Boolean(
    (typeof input?.prompt === 'string' && input.prompt.trim())
    || filled(input?.seedTrackIds)
    || (typeof input?.seedArtist === 'string' && input.seedArtist.trim())
    || sources.recentlyAdded
    || filled(knobs.moods)
    || filled(knobs.genres)
    || filled(knobs.artists)
    || filled(knobs.energies)
    || erasWithBounds
    || knobs.minBpm
    || knobs.maxBpm
    || knobs.instrumentalOnly,
  );
}

// The recipe behind a sync-enabled playlist — the same shape /generate takes,
// minus excludeTrackIds. Every field is lenient (see the header): this schema
// is also what the recipe-store read runs, and it must never throw.
export const playlistRecipeSchema = z.preprocess(
  playlistBody,
  z.object({
    prompt: playlistText,
    seedTrackIds: playlistIdList,
    seedArtist: playlistText,
    knobs: playlistLooseRecord,
    sources: playlistLooseRecord,
  }),
);
export type PlaylistRecipeParsed = z.output<typeof playlistRecipeSchema>;

// POST /playlists/generate and .../generate/jobs — an unsaved candidate list.
export const playlistGenerateSchema = z.preprocess(
  playlistBody,
  z
    .object({
      prompt: playlistText,
      seedTrackIds: playlistIdList,
      seedArtist: playlistText,
      knobs: playlistLooseRecord,
      sources: playlistLooseRecord,
      excludeTrackIds: playlistIdList,
    })
    .refine(playlistHasIntent, 'give a prompt, seeds, a source, or at least one knob to generate from'),
);

// POST /playlists — create, or overwrite when playlistId is present.
export const playlistSaveSchema = z.preprocess(
  playlistBody,
  z.object({
    name: z
      .string({ error: 'name is required' })
      .trim()
      .min(1, 'name is required')
      .max(PLAYLIST_NAME_MAX, `name must be 1-${PLAYLIST_NAME_MAX} chars`),
    songIds: playlistIdList,
    playlistId: z.unknown().optional().transform((v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)),
    keepInSync: z.unknown().optional().transform((v) => v === true),
    recipe: playlistRecipeSchema,
  }),
);

// POST /playlists/:id/tracks — append.
export const playlistAppendSchema = z.preprocess(
  playlistBody,
  z.object({
    songIds: playlistIdList.refine((ids) => ids.length > 0, 'songIds is required'),
  }),
);

// PATCH /playlists/:id — rename / visibility. A patch that changes nothing is
// the operator's input being wrong, so it rejects.
//
// A non-string `name` reads as ABSENT rather than as a type error, which is
// what the hand-rolled reader did and is deliberately preserved: `{name: 42,
// public: true}` flips the visibility and drops the rename silently. Worth
// knowing before relying on the opposite — the only caller is the admin row
// editor, which cannot produce a non-string, so tightening it would buy a rule
// nothing can trip while changing an API answer somebody may depend on.
export const playlistPatchSchema = z.preprocess(
  playlistBody,
  z
    .object({
      name: z
        .unknown()
        .optional()
        .transform((v) => (typeof v === 'string' ? v.trim() : undefined))
        .refine((v) => v === undefined || v.length > 0, 'name cannot be empty')
        .refine(
          (v) => v === undefined || v.length <= PLAYLIST_NAME_MAX,
          `name must be 1-${PLAYLIST_NAME_MAX} chars`,
        ),
      public: z.unknown().optional().transform((v) => (typeof v === 'boolean' ? v : undefined)),
    })
    .check((c) => {
      if (c.value.name === undefined && c.value.public === undefined) {
        c.issues.push({
          code: 'custom',
          input: c.value,
          message: 'nothing to update — send name and/or public',
        });
      }
    }),
);

// DELETE /playlists/:id/tracks — remove by position.
export const playlistRemoveTracksSchema = z.preprocess(
  playlistBody,
  z.object({
    indexes: z
      .unknown()
      .optional()
      .transform((v): number[] =>
        (Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0) : []))
      .refine((xs) => xs.length > 0, 'indexes is required'),
  }),
);

/**
 * Lenient repair for one stored recipe-store row (state/playlist-recipes.json,
 * read at boot and by every sync). A row is DROPPED when it has no identity
 * (no playlistId) or no recipe at all; every other field is REPAIRED — the
 * store read used to keep any row carrying a string playlistId and nothing
 * else, so a hand-edited entry missing its `recipe` reached syncRecipe and
 * threw on `entry.recipe.prompt`, turning "Sync now" into a 500.
 *
 * WHY A MISSING RECIPE DROPS RATHER THAN REPAIRS. An empty recipe is not a
 * neutral value for this shape: buildCandidatePool reads an absent knob as NO
 * FILTER, not as "match nothing", so `{seedTrackIds: [], knobs: {}, sources:
 * {}}` is a recipe that matches the whole library. Repairing to it would turn
 * a loud 500 into a quiet wrong result — syncRecipe would append perSyncCap
 * arbitrary tracks added since createdAt, answer `{added: 25}` as success, and
 * recordSync would persist the invented recipe. That also runs unattended via
 * syncAllAfterTag() after every tagging pass. Dropping keeps the never-throws
 * property without inventing intent the operator never expressed.
 */
export function normalizeRecipeRow(raw: unknown): {
  playlistId: string;
  name: string;
  recipe: PlaylistRecipeParsed;
  perSyncCap: number;
  createdAt: string;
  lastSyncedAt: string | null;
  lastResult: { added: number; at: string } | null;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.playlistId !== 'string' || !r.playlistId.trim()) return null;
  if (!r.recipe || typeof r.recipe !== 'object' || Array.isArray(r.recipe)) return null;
  const lastResult = r.lastResult && typeof r.lastResult === 'object'
    && Number.isInteger((r.lastResult as Record<string, unknown>).added)
    && typeof (r.lastResult as Record<string, unknown>).at === 'string'
    ? { added: (r.lastResult as { added: number }).added, at: (r.lastResult as { at: string }).at }
    : null;
  return {
    playlistId: r.playlistId,
    name: typeof r.name === 'string' ? r.name : '',
    // Never throws: every field of the recipe schema is a lenient coercer.
    recipe: playlistRecipeSchema.parse(r.recipe),
    perSyncCap: Number.isInteger(r.perSyncCap) && (r.perSyncCap as number) > 0 ? (r.perSyncCap as number) : 25,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    lastSyncedAt: typeof r.lastSyncedAt === 'string' ? r.lastSyncedAt : null,
    lastResult,
  };
}

// ─── from controller/src/schemas/request.ts ──────────────────────────────

// Shared listener-request schema — the public request box's POST /request body
// ({ text, name }). One box per skin, six boxes total, all posting the same two
// fields; the caps used to live server-side only (a slice, not a rule), so the
// boxes invited text the booth then silently cut. Executed on BOTH sides: the
// controller runs it at the route boundary (middleware/validate.ts), and the
// web player runs it once in PlayerCore's submitRequest action — the one
// chokepoint every skin's box already goes through — so a refusal reads as a
// plain message before the network is ever touched.
//
// What this schema deliberately does NOT own: the on-air safety pipeline.
// Injection stripping, scripted-opener cuts, reserved-name screening and the
// 'anon' fallback are guard POLICY over accepted input (util/request-guard.ts,
// pinned by scripts/request-guard.test.ts) — they need server state (the
// persona roster) and they repair rather than refuse by design. The schema
// answers only "is this a well-formed request", the guard answers "what may
// reach the air".
//
// HARD RULE: this file may import ONLY from 'zod'. It is copied verbatim into
// the web bundle. Enforced by controller/eslint.config.mjs and gen-schemas.ts.

// Homed here so the route, the guard and the browser share one figure.
// middleware/ratelimit.ts used to own the text cap (as a slice — over-long
// text was silently truncated, which could cut a request mid-thought and have
// the DJ answer half of it); util/request-guard.ts keeps applying the name cap
// as its belt (its NAME_MAX is an alias of this).
export const REQUEST_TEXT_MAX = 280;
export const REQUEST_NAME_MAX = 40;

// Explicit null reads as absent, as the `typeof x === 'string' ? x : ''`
// readers this replaces always did. (Named per-module: the mirror is one flat
// file.)
const requestNullToUndefined = (v: unknown) => (v == null ? undefined : v);

// Messages are listener-facing: the pre-flight gate in the player surfaces
// them verbatim, so each one has to stand alone without a field prefix.
// 'Empty request' keeps the historical wire message for API callers.
//
// The SERVER half of that promise is middleware/validate.ts's
// validatePublicBody, not the ordinary validateBody — firstMessage prefixes the
// dotted path unconditionally, so routing this schema through the operator
// middleware would put "text: " in front of every one of these strings on the
// wire while the browser (which reads issues[0].message) saw them bare. Two
// sides, one schema, two different messages, is exactly what these conversions
// exist to prevent.
export const listenerRequestSchema = z.object({
  text: z
    .string({ error: 'Empty request' })
    .trim()
    .min(1, 'Empty request')
    .max(REQUEST_TEXT_MAX, `Keep it under ${REQUEST_TEXT_MAX} characters.`),
  // Optional decoration, but a refusal beats the old silent slice-to-40 — and
  // no `.catch()`, which could not tell a wrong type from a too-long value
  // (the imaging description lesson). Reserved names and junk scripts are the
  // guard's business, downstream of acceptance.
  name: z.preprocess(
    requestNullToUndefined,
    z
      .string({ error: 'Names must be plain text.' })
      .trim()
      .max(REQUEST_NAME_MAX, `Keep the name under ${REQUEST_NAME_MAX} characters.`)
      .default(''),
  ),
});

// ─── from controller/src/schemas/schedule.ts ─────────────────────────────

// Shared schedule schema — the weekly grid (#shows) and the timed takeover
// (#930), executed on BOTH sides. The controller runs it in
// settings.validate.validateScheduleStrict / validateScheduleOverrideStrict
// (the update() chokepoint), in settings.normalize.normalizeSchedule /
// normalizeScheduleOverride (the lenient load path) and in the PUT /schedule +
// POST /schedule/override route middleware; the browser runs the mirrored copy
// (web/lib/schemas.generated.ts) for the takeover dialog's minute bounds.
//
// HARD RULE: this file may import ONLY from 'zod'. It is copied verbatim into
// the web bundle, so a project import or a node builtin here breaks the mirror.
// That includes OTHER schema modules — the mirror is one flat concatenation, so
// gen-schemas.ts rejects every specifier but 'zod' and each module has to stand
// alone.
//
// WHY A FACTORY, like shows. A schedule slot cannot be validated against
// itself: it either names a real show or it names nothing. That single input
// travels as a ScheduleSchemaContext whose `showIds` is NULLABLE, and null
// means the same thing it means for a show — **this caller cannot check that
// rule**. It is what lets three postures share one schema:
//
//   strict  (update())      showIds = the live roster  → unknown id THROWS
//   lenient (load)          showIds = the live roster  → unknown id is REPAIRED
//                                                        away before parsing
//   route   (PUT /schedule) showIds = null             → shape only; the ids are
//                                                        resolved afterwards by
//                                                        resolveScheduleSlots,
//                                                        which DROPS and COUNTS
//
// That third posture is not a schema rule and must not become one: the panel
// can hold a locally-added show the operator has not saved yet, so PUT
// /schedule deliberately answers 200 with a `dropped` count rather than 400.

// 0 (Sunday) .. 6 (Saturday), matching JS Date.getDay(); 24 hours per day.
// Previously written as bare 7 / 24 literals in six files across both packages.
export const SCHEDULE_DAYS = 7;
export const SCHEDULE_HOURS = 24;

// Bounds for POST /schedule/override's `minutes` — long enough for an all-day
// takeover, short enough that a forgotten pin can't shadow the grid for days.
// Homed here because web/components/admin/dash/TakeoverCard.tsx carried a
// hand-copied pair under a "Mirror the controller's OVERRIDE_MIN/MAX_MINUTES"
// comment, which is exactly the drift these conversions exist to delete.
export const OVERRIDE_MIN_MINUTES = 15;
export const OVERRIDE_MAX_MINUTES = 720;

/** A blank 7-day x 24-hour grid. Each value is an array[24] of showId|null. */
export function emptyWeek(): ScheduleWeek {
  const week: ScheduleWeek = {};
  for (let d = 0; d < SCHEDULE_DAYS; d++) week[d] = Array(SCHEDULE_HOURS).fill(null);
  return week;
}

export type ScheduleWeek = Record<number, Array<string | null>>;

export interface ScheduleSchemaContext {
  /**
   * The show ids a slot may name, or null when this caller cannot check.
   *
   * Non-null and a slot names something else → an issue. Null → the shape is
   * checked and every id is taken on trust, for a caller that resolves ids
   * itself (the route) or has no roster yet.
   */
  showIds: string[] | null;
}

// A stored slot: a show id, or any of the three ways "nothing" has been written
// to settings.json over the years (null, undefined, empty string).
const scheduleSlotSchema = z
  .union([z.string(), z.null()], { error: 'must be a show id or null' })
  .optional();

// Exactly 24 entries when the day is present at all — the rule the strict
// validator has always enforced. An absent or null day is a blank day, not an
// error, so a partial grid still loads.
const scheduleDaySchema = z
  .array(scheduleSlotSchema)
  .length(SCHEDULE_HOURS, `must be an array of exactly ${SCHEDULE_HOURS} entries`)
  .nullish();

// The grid has always been persisted as an object keyed "0".."6". An ARRAY of
// seven days is accepted here only because the hand-rolled validator it
// replaces read `raw[d]` and therefore took one without noticing; z.object
// rejects arrays outright, so without this a shape that used to load would
// start failing at boot.
function toScheduleWeekRecord(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = {};
  raw.slice(0, SCHEDULE_DAYS).forEach((day, i) => {
    out[i] = day;
  });
  return out;
}

type ParsedWeek = Record<number, Array<string | null | undefined> | null | undefined>;

function toScheduleWeek(parsed: unknown): ScheduleWeek {
  const src = parsed as ParsedWeek;
  const week = emptyWeek();
  for (let d = 0; d < SCHEDULE_DAYS; d++) {
    const day = src[d];
    if (!day) continue;
    for (let h = 0; h < SCHEDULE_HOURS; h++) {
      const v = day[h];
      week[d]![h] = typeof v === 'string' && v !== '' ? v : null;
    }
  }
  return week;
}

export function scheduleSchema(ctx: ScheduleSchemaContext) {
  return z
    .preprocess(
      toScheduleWeekRecord,
      z.object(
        {
          0: scheduleDaySchema,
          1: scheduleDaySchema,
          2: scheduleDaySchema,
          3: scheduleDaySchema,
          4: scheduleDaySchema,
          5: scheduleDaySchema,
          6: scheduleDaySchema,
        },
        { error: 'must be an object keyed 0-6' },
      ),
    )
    // Cross-slot rather than per-slot so the issue path is the real coordinate
    // (`schedule.3.14`), which is what firstMessage prints and what an operator
    // needs in order to find the cell.
    .check((c) => {
      if (!ctx.showIds) return;
      const ids = new Set(ctx.showIds);
      const week = c.value as ParsedWeek;
      for (let d = 0; d < SCHEDULE_DAYS; d++) {
        const day = week[d];
        if (!day) continue;
        for (let h = 0; h < SCHEDULE_HOURS; h++) {
          const v = day[h];
          if (typeof v === 'string' && v !== '' && !ids.has(v)) {
            c.issues.push({
              code: 'custom',
              input: v,
              path: [d, h],
              message: 'references an unknown show',
            });
          }
        }
      }
    })
    .transform(toScheduleWeek);
}

/**
 * PUT /schedule's body — the bare grid, or one wrapped in `{ schedule }`.
 *
 * Both spellings were accepted by `req.body?.schedule ?? req.body` and both
 * still are. Ids are NOT checked here (see the header): the route resolves them
 * against the live roster with resolveScheduleSlots and reports a count.
 *
 * This DOES newly reject a day that is present but not exactly 24 entries long,
 * where the route silently padded it with nulls. Same call the stations
 * conversion made three times: a grid quietly reshaped server-side is a grid
 * the operator cannot tell was reshaped, and the strict validator behind
 * update() has always refused it — so accepting it at the route only meant the
 * two disagreed about the same data.
 */
export const scheduleSaveSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'schedule' in raw) {
    return (raw as { schedule: unknown }).schedule;
  }
  return raw;
}, scheduleSchema({ showIds: null }));

/**
 * Resolve a shape-valid grid against the live roster, dropping and COUNTING
 * slots that name a show which isn't persisted.
 *
 * Pure, and deliberately not a schema rule — PUT /schedule answers 200 with
 * `dropped` because the editor can hold a locally-added show the operator
 * hasn't saved yet, and rejecting the save would strand it.
 */
export function resolveScheduleSlots(
  week: ScheduleWeek,
  showIds: string[],
): { schedule: ScheduleWeek; dropped: number } {
  const ids = new Set(showIds);
  const schedule = emptyWeek();
  let dropped = 0;
  for (let d = 0; d < SCHEDULE_DAYS; d++) {
    for (let h = 0; h < SCHEDULE_HOURS; h++) {
      const v = week[d]?.[h] ?? null;
      if (!v) continue;
      if (ids.has(v)) schedule[d]![h] = v;
      else dropped++;
    }
  }
  return { schedule, dropped };
}

/**
 * The load path's repair: everything unrecognised becomes an empty slot.
 *
 * Lives beside the rule it repairs against, like repairShowForLoad — a repair
 * in normalize.ts restating ~5 schema rules inline is how the shows load path
 * ended up able to delete a whole show. Each repair lands on a value the strict
 * path would accept, and the schema is still run on the result.
 */
export function repairScheduleForLoad(raw: unknown, showIds: string[]): ScheduleWeek {
  const week = emptyWeek();
  const src = toScheduleWeekRecord(raw);
  if (!src || typeof src !== 'object') return week;
  const ids = new Set(showIds);
  const days = src as Record<number, unknown>;
  for (let d = 0; d < SCHEDULE_DAYS; d++) {
    const day = days[d];
    if (!Array.isArray(day)) continue;
    for (let h = 0; h < SCHEDULE_HOURS; h++) {
      const v = day[h];
      if (typeof v === 'string' && ids.has(v)) week[d]![h] = v;
    }
  }
  return week;
}

// ── Timed takeover (#930) ────────────────────────────────────────────────────

/** Pin one show for a bounded window, then the weekly grid resumes. */
export interface ScheduleOverride {
  showId: string;
  startedAt: number;
  expiresAt: number;
}

export interface ScheduleOverrideContext {
  /** Show ids the pin may name, or null when this caller cannot check. */
  showIds: string[] | null;
  /**
   * Epoch-ms "now", or null to not judge expiry at all.
   *
   * Only the LOAD path passes a clock: an override that has already run out is
   * transient state worth dropping at boot, whereas update() persisting one
   * with a past `expiresAt` is not an input error — the operator's own window
   * simply ended, and throwing there would fail an unrelated settings save.
   */
  now: number | null;
}

export function scheduleOverrideSchema(ctx: ScheduleOverrideContext) {
  return z
    .object({
      showId: z.string({ error: 'must be a show id' }).min(1, 'must be a show id'),
      startedAt: z.number({ error: 'must be an epoch-ms number' }).finite('must be an epoch-ms number'),
      expiresAt: z.number({ error: 'must be an epoch-ms number' }).finite('must be an epoch-ms number'),
    })
    .check((c) => {
      const { showId, startedAt, expiresAt } = c.value;
      if (ctx.showIds && !ctx.showIds.includes(showId)) {
        c.issues.push({
          code: 'custom',
          input: showId,
          path: ['showId'],
          message: 'references an unknown show',
        });
      }
      if (startedAt >= expiresAt) {
        c.issues.push({
          code: 'custom',
          input: expiresAt,
          path: ['expiresAt'],
          message: 'must be after startedAt',
        });
      } else if (expiresAt - startedAt > OVERRIDE_MAX_MINUTES * 60_000) {
        c.issues.push({
          code: 'custom',
          input: expiresAt,
          path: ['expiresAt'],
          message: `window must be at most ${OVERRIDE_MAX_MINUTES} minutes`,
        });
      }
      if (ctx.now !== null && expiresAt <= ctx.now) {
        c.issues.push({
          code: 'custom',
          input: expiresAt,
          path: ['expiresAt'],
          message: 'window has already expired',
        });
      }
    });
}

/**
 * POST /schedule/override's body.
 *
 * `minutes` is coerced because the hand-rolled route ran `Number(req.body
 * ?.minutes)` and therefore accepted the string "60". An EMPTY showId now 400s
 * where it used to reach the roster lookup and 404 as `no such show: ` — a
 * missing field is a malformed request, not a missing show. A real id that
 * isn't in the roster still 404s from the handler, which is the answer that
 * needs server state.
 */
export const scheduleOverrideRequestSchema = z.object({
  showId: z.string({ error: 'pick a show to pin' }).min(1, 'pick a show to pin'),
  minutes: z.coerce
    .number({ error: `must be an integer between ${OVERRIDE_MIN_MINUTES} and ${OVERRIDE_MAX_MINUTES}` })
    .int(`must be an integer between ${OVERRIDE_MIN_MINUTES} and ${OVERRIDE_MAX_MINUTES}`)
    .min(OVERRIDE_MIN_MINUTES, `must be an integer between ${OVERRIDE_MIN_MINUTES} and ${OVERRIDE_MAX_MINUTES}`)
    .max(OVERRIDE_MAX_MINUTES, `must be an integer between ${OVERRIDE_MIN_MINUTES} and ${OVERRIDE_MAX_MINUTES}`),
});

// ─── from controller/src/schemas/show.ts ─────────────────────────────────

// Shared show schema — the single source of truth for a show's shape, executed
// on BOTH sides. The controller runs it in settings.validate.validateShowsStrict
// (the update() chokepoint), in settings.normalize.normalizeShows (the lenient
// load path) and in the POST /shows route middleware; the browser runs the
// mirrored copy (web/lib/schemas.generated.ts).
//
// HARD RULE: this file may import ONLY from 'zod'. It is copied verbatim into
// the web bundle, so a project import or a node builtin here breaks the mirror.
// That includes OTHER schema modules — the mirror is one flat concatenation, so
// gen-schemas.ts rejects every specifier but 'zod' and each module has to stand
// alone. SHOW_ID_RE is therefore declared here and re-exported by
// settings/vocab.ts as ID_RE rather than living in a shared module.
//
// WHY A FACTORY. Unlike webhooks and stations, a show cannot be validated
// against itself: `personaId` has to name a real persona, `moods` a live mood,
// `themeId` an installed theme, and `maxTrackSeconds` clears a floor derived
// from the station's crossfade. Those four travel as ONE ShowSchemaContext
// value rather than as separate arguments — the shape the old four-parameter
// validateShowsStrict(raw, personas, allowedThemeIds, moodNames) grew into, and
// the same "one scope value, never unpacked" rule PickerScope follows. Both
// sides can build it: the admin panel already fetches personas, moods, themes
// and the station settings.
//
// Rules that are NOT pure functions of the submitted value — id minting and
// cross-row de-duplication — live in show-server.ts, which is NOT mirrored.

// Entity id: shows, personas and skills all share this pattern. Homed here
// because show is the first of the three to convert and a mirrored module
// cannot import a shared one (see the header). settings/vocab.ts re-exports it
// as ID_RE; whoever converts personas should decide its permanent home.
export const SHOW_ID_RE = /^[a-z0-9_]{3,32}$/;

export const SHOWS_LIMIT = 64;
export const SHOW_NAME_MAX = 60;
export const SHOW_TOPIC_MAX = 2000;
export const GUESTS_PER_SHOW = 3;
export const PLAYLISTS_PER_SHOW = 10;
export const EXCLUDED_PLAYLISTS_PER_SHOW = 10;
// Per-attribute ceiling on the multi-value music filters (#929).
export const SHOW_FILTER_VALUES_MAX = 15;
export const SHOW_GENRE_MAX = 64;
export const SHOW_SEGMENT_SKILL_MAX = 64;
export const SHOW_THEME_ID_MAX = 64;
export const SHOW_YEAR_MIN = 1900;
export const SHOW_YEAR_MAX = 2100;
// Also the STATION-wide cap's ceiling — settings/defaults.ts BOUNDS reads it
// from here, because the strict show validator has always bounds-checked a
// show's override against the station figure and two copies would drift.
export const SHOW_MAX_TRACK_SECONDS = 36000;

export const SHOW_ENERGY = ['low', 'medium', 'high'] as const;
export const SHOW_VOCALS = ['instrumental', 'vocal'] as const;

export type EraWindow = { fromYear: number | null; toYear: number | null };

/**
 * Everything a show can only be judged against from outside itself.
 *
 * Three fields are NULLABLE, and null always means the same thing: **this
 * caller cannot check that rule**, so leave the value alone. That is how the
 * lenient load path and the strict save path share one schema without either
 * restating a rule — the difference between them becomes CONTEXT rather than a
 * second implementation:
 *
 *   - `moodNames: null` — load runs before the mood cache is built, and moods
 *     are operator-editable, so filtering against the seed defaults there would
 *     strip an operator's own moods. A stale mood just matches nothing on air.
 *   - `themeIds: null` — load has no theme registry to consult. A stale id is
 *     harmless: GET /themes falls back to the station default at serve time.
 *   - `minTrackSeconds: null` — the crossfade-derived floor. Load clamps to the
 *     hard bounds instead of enforcing it.
 *
 * `personaIds` is NOT nullable: a show whose host does not exist has no owner
 * on either path. Strict throws, lenient drops the row — same rule, different
 * consequence, which is exactly the split that is allowed.
 */
export interface ShowSchemaContext {
  personaIds: string[];
  moodNames: string[] | null;
  themeIds: string[] | null;
  minTrackSeconds: number | null;
}

// Booleans are compared to `true` rather than typed as z.boolean(), which is
// deliberate and load-bearing: BOTH the strict and the lenient path have always
// read these as `item.banter === true`, so they already agree, and tightening
// only the schema would make load and save disagree about a value neither
// considers worth failing a show over. A string 'yes' reads as off, as it
// always has.
const showBool = () => z.unknown().optional().transform((v) => v === true);

// Explicit null reads as "absent" on every OPTIONAL field. The pre-schema
// validator accepted null everywhere it accepted an omission (`String(x ?? '')`,
// `!= null` guards), and clients or serializers that write null for empty
// fields relied on that. zod's `.default()` fires only on undefined, so without
// this preprocess a `{topic: null}` that has always saved cleanly would 400 —
// and because update() re-validates the whole array, one null field on one show
// would fail the entire shows/schedule save.
const nullToUndefined = (v: unknown) => (v == null ? undefined : v);

// Trimmed, non-empty, capped, de-duplicated, in first-seen order — the shape
// every one of a show's list filters takes. `key` is what dedup compares, so
// genres can be case-insensitive while ids are exact.
function showStringList(opts: {
  max: number;
  itemMax?: number;
  itemError?: string;
  values?: readonly string[];
  key?: (v: string) => string;
  overflowError: string;
}) {
  let item = z.string({ error: opts.itemError ?? 'must be a string' }).trim();
  if (opts.itemMax) item = item.max(opts.itemMax, opts.itemError ?? `must be ${opts.itemMax} characters or fewer`);
  const base = opts.values
    ? z.enum(opts.values as [string, ...string[]], {
        error: `must be one of: ${(opts.values as readonly string[]).join(', ')}`,
      })
    : item;
  return z.preprocess(
    nullToUndefined,
    z
      .array(base)
      .max(opts.max, opts.overflowError)
      .default([])
      .transform((xs) => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const v of xs) {
          if (!v) continue;
          const k = opts.key ? opts.key(v) : v;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(v);
        }
        return out;
      }),
  );
}

// One era-window year bound, shared by the schema's own showYear pipeline and
// the load path's repairEraWindow (below) so the two can never disagree about
// what a valid year is. null / '' means "open end". A numeric string is
// accepted because that is what an <input type="number"> posts.
const eraYearOf = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const validEraYear = (n: number | null): boolean =>
  n == null || (Number.isInteger(n) && n >= SHOW_YEAR_MIN && n <= SHOW_YEAR_MAX);

const showYear = z
  .union([z.null(), z.literal(''), z.number(), z.string()])
  .optional()
  .transform((v) => eraYearOf(v))
  .refine(validEraYear, `must be an integer between ${SHOW_YEAR_MIN} and ${SHOW_YEAR_MAX}`);

const showEra = z
  .object({ fromYear: showYear, toYear: showYear })
  .refine(
    (w) => w.fromYear == null || w.toYear == null || w.fromYear <= w.toYear,
    'fromYear must be less than or equal to toYear',
  );

/**
 * The legacy singular fields #929 replaced with plural lists.
 *
 * BOTH paths migrate them. The pre-schema strict validator always accepted a
 * legacy `mood` from an older client or a pre-#929 backup and folded it into
 * the plural list ("a legacy singular mood from an older client still
 * validates" was its own comment), so a refusal here would turn a working
 * backup restore through settings.update() into a hard failure. Migration runs
 * INSIDE the schema (the preprocess in showSchema below) rather than at any
 * call site, because z.object strips unknown keys: a route that parses the
 * object directly would otherwise silently drop a legacy `mood` and report
 * success — the exact silent loss #929's migration exists to prevent.
 */
export const LEGACY_SHOW_FIELDS = [
  'mood',
  'genre',
  'energy',
  'fromYear',
  'toYear',
  'maxTrackMinutes',
] as const;

/**
 * Fill the plural fields from any legacy singular ones.
 *
 * `genre` splits on commas because operators crammed multiple genres into the
 * one free-text field ("funk, soul, jazz-funk"), which never resolved against
 * the library as a single tag.
 */
export function migrateLegacyShowFields(raw: unknown): Record<string, unknown> {
  const rec = { ...(raw as Record<string, unknown>) };
  if (!Array.isArray(rec.moods) && rec.mood != null && rec.mood !== '') rec.moods = [rec.mood];
  if (!Array.isArray(rec.genres) && typeof rec.genre === 'string' && rec.genre.trim()) {
    rec.genres = rec.genre.split(',');
  }
  if (!Array.isArray(rec.energies) && rec.energy != null && rec.energy !== '') {
    rec.energies = [rec.energy];
  }
  if (!Array.isArray(rec.eras) && (rec.fromYear != null || rec.toYear != null)) {
    rec.eras = [{ fromYear: rec.fromYear ?? null, toYear: rec.toYear ?? null }];
  }
  if ((rec.maxTrackSeconds == null || rec.maxTrackSeconds === '') &&
      rec.maxTrackMinutes != null && rec.maxTrackMinutes !== '') {
    rec.maxTrackSeconds = Number(rec.maxTrackMinutes) * 60;
  }
  for (const k of LEGACY_SHOW_FIELDS) delete rec[k];
  return rec;
}

export function showSchema(ctx: ShowSchemaContext) {
  // Migration must run BEFORE the object parse — z.object strips unknown keys,
  // so by the time any .check() or field schema sees the value the legacy keys
  // are already gone. Running it here rather than at call sites is what makes
  // every caller — update(), POST /shows, the lenient load, the browser — give
  // the same answer for the same payload. A migrated value is then validated by
  // the same field schemas as a native one, so a legacy `energy: 'bogus'` still
  // fails exactly like `energies: ['bogus']` would.
  return z.preprocess(
    (raw) => (raw && typeof raw === 'object' ? migrateLegacyShowFields(raw) : raw),
    showObjectSchema(ctx),
  );
}

function showObjectSchema(ctx: ShowSchemaContext) {
  return z
    .object({
      // Optional because a brand-new show has no id yet — the server mints one.
      //
      // A MALFORMED id is re-minted rather than rejected (.catch → undefined,
      // then show-server.resolveShowIds mints), which is what both paths have
      // always done and is deliberately unlike the webhook schema. A webhook id
      // only resolves that row's stored secret, so rejecting a bad one costs
      // nothing; a SHOW id is what every slot in the weekly schedule grid points
      // at, so the same tightening would turn one malformed id in a restored
      // backup into a refusal to restore the station at all.
      id: z
        .string()
        .regex(SHOW_ID_RE, 'id must be 3-32 characters: lowercase letters, digits or underscores')
        .optional()
        .catch(undefined),
      name: z
        .string({ error: 'name must be 1-60 chars' })
        .trim()
        .min(1, 'name must be 1-60 chars')
        .max(SHOW_NAME_MAX, `name must be 1-${SHOW_NAME_MAX} chars`),
      topic: z.preprocess(
        nullToUndefined,
        z
          .string()
          .trim()
          .max(SHOW_TOPIC_MAX, `topic must be 0-${SHOW_TOPIC_MAX} chars`)
          .default(''),
      ),
      personaId: z
        .string({ error: 'Pick a host persona' })
        .refine((v) => ctx.personaIds.includes(v), 'must reference an existing persona'),
      // Host exclusion and de-duplication happen in the object transform below,
      // where the host id is in scope.
      guestPersonaIds: z.preprocess(
        nullToUndefined,
        z
          .array(
            z
              .string()
              .refine((v) => ctx.personaIds.includes(v), 'must reference existing personas'),
          )
          .max(GUESTS_PER_SHOW, `must have at most ${GUESTS_PER_SHOW} entries`)
          .default([]),
      ),
      banter: showBool(),
      programme: showBool(),
      // Free text, resolved against the live skill catalog at air time — a
      // stale kind degrades to the producer's choice rather than blocking a save.
      segmentSkill: z.preprocess(
        nullToUndefined,
        z
          .string()
          .trim()
          .max(SHOW_SEGMENT_SKILL_MAX, `must be ${SHOW_SEGMENT_SKILL_MAX} characters or fewer`)
          .default(''),
      ),
      // Empty means "Any": the show pins no mood and the autonomous
      // dominantMood chain (festival > weather > time) applies on air.
      moods: showStringList({
        max: SHOW_FILTER_VALUES_MAX,
        values: ctx.moodNames ?? undefined,
        overflowError: `must have at most ${SHOW_FILTER_VALUES_MAX} entries`,
      }),
      // A stale id is DROPPED to '' rather than rejected — the tolerance #917's
      // theme.active twin established. Throwing here bricked EVERY shows and
      // schedule save, and every full restore, for any install still carrying
      // one retired palette id on one show, because update() re-validates the
      // whole array. Self-heals on the next save. The caller reports the drop
      // (this module stays side-effect free, so no console.warn here).
      themeId: z.preprocess(
        nullToUndefined,
        z
          .string()
          .trim()
          .max(SHOW_THEME_ID_MAX)
          .default('')
          .transform((v) => (!v || !ctx.themeIds || ctx.themeIds.includes(v) ? v : '')),
      ),
      // Free text resolved fuzzily against the live library at pick time, so
      // never checked against Subsonic here. Dedup is case-insensitive.
      genres: showStringList({
        max: SHOW_FILTER_VALUES_MAX,
        itemMax: SHOW_GENRE_MAX,
        itemError: `genres entries must be ${SHOW_GENRE_MAX} characters or fewer`,
        key: (v) => v.toLowerCase(),
        overflowError: `must have at most ${SHOW_FILTER_VALUES_MAX} entries`,
      }),
      energies: showStringList({
        max: SHOW_FILTER_VALUES_MAX,
        values: SHOW_ENERGY,
        overflowError: `must have at most ${SHOW_FILTER_VALUES_MAX} entries`,
      }),
      // Windows with no bound at all are dropped; the rest de-duplicate on the
      // pair.
      eras: z.preprocess(
        nullToUndefined,
        z
          .array(showEra)
          .max(SHOW_FILTER_VALUES_MAX, `must have at most ${SHOW_FILTER_VALUES_MAX} entries`)
          .default([])
          .transform((xs) => {
            const seen = new Set<string>();
            const out: EraWindow[] = [];
            for (const w of xs) {
              if (w.fromYear == null && w.toYear == null) continue;
              const k = `${w.fromYear ?? ''}:${w.toYear ?? ''}`;
              if (seen.has(k)) continue;
              seen.add(k);
              out.push({ fromYear: w.fromYear, toYear: w.toYear });
            }
            return out;
          }),
      ),
      // One value, not a list — instrumental and vocal are mutually exclusive
      // and wanting both is wanting neither. '' is no constraint, so a show
      // predating the field round-trips unchanged.
      vocals: z
        .union([z.null(), z.literal(''), z.enum(SHOW_VOCALS)])
        .optional()
        .transform((v) => v ?? ''),
      // Opt-in hard filter across every set music constraint. The legacy
      // genre-only `genreStrict` is deliberately NOT carried over: the toggle
      // now spans mood/genre/era/energy, so migrating it would harden filters
      // an old show never opted into.
      filtersStrict: showBool(),
      // null = inherit the station default, 0 = unlimited, >0 = this show's cap.
      maxTrackSeconds: z
        .union([z.null(), z.literal(''), z.number(), z.string()])
        .optional()
        .transform((v) => (v == null || v === '' ? null : Number(v)))
        .refine(
          (n) =>
            n == null ||
            (Number.isInteger(n) && n >= 0 && n <= SHOW_MAX_TRACK_SECONDS),
          `must be an integer between 0 and ${SHOW_MAX_TRACK_SECONDS}`,
        )
        // Shows have no crossfade of their own, so the floor is the station's.
        // 0 (inherit/unlimited) always stays allowed.
        .refine(
          (n) => n == null || n === 0 || ctx.minTrackSeconds == null || n >= ctx.minTrackSeconds,
          `must be 0 (inherit/unlimited) or at least the station's minimum track length`,
        ),
      // Shape-checked only: ids resolve against the live Navidrome at pick
      // time, so a stale one contributes nothing rather than failing a save.
      playlistIds: showStringList({
        max: PLAYLISTS_PER_SHOW,
        overflowError: `must have at most ${PLAYLISTS_PER_SHOW} entries`,
      }),
      playlistStrict: showBool(),
      excludedPlaylistIds: showStringList({
        max: EXCLUDED_PLAYLISTS_PER_SHOW,
        overflowError: `must have at most ${EXCLUDED_PLAYLISTS_PER_SHOW} entries`,
      }),
    })
    // Needs two fields at once, so it cannot live on guestPersonaIds itself.
    .check((c) => {
      if (c.value.guestPersonaIds.includes(c.value.personaId)) {
        c.issues.push({
          code: 'custom',
          input: c.value.guestPersonaIds,
          path: ['guestPersonaIds'],
          message: "must not include the show's host persona",
        });
      }
    })
    .transform((s) => ({
      ...s,
      guestPersonaIds: [...new Set(s.guestPersonaIds)].filter((id) => id !== s.personaId),
    }));
}

export type ShowParsed = z.output<ReturnType<typeof showSchema>>;
export type Show = ShowParsed & { id: string };

export function showsSchema(ctx: ShowSchemaContext) {
  return z.array(showSchema(ctx)).max(SHOWS_LIMIT, `must be at most ${SHOWS_LIMIT} entries`);
}

// POST /shows submits ONE show under a `show` key and merges it server-side.
export function showPostSchema(ctx: ShowSchemaContext) {
  return z.object({ show: showSchema(ctx) });
}

// ── Lenient per-field repairs (the LOAD path) ────────────────────────────────
//
// settings/normalize.ts's normalizeShows repairs a stored show field-by-field
// BEFORE running the schema, so a stale mood or a mistyped list entry costs the
// show that one value, not the show. The repairs live HERE, beside the rules
// they repair against, because a repair restated at the call site is a repair
// that can drift from the schema — and the failure mode of that drift is the
// worst one available: the lenient parse fails, `continue` drops the row, and a
// working show silently vanishes on the next boot.

/**
 * One era window, repaired: numeric-string years accepted (same eraYearOf the
 * schema's own showYear runs), out-of-range or backwards windows dropped as
 * null rather than failing the show.
 */
export function repairEraWindow(raw: unknown): EraWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as { fromYear?: unknown; toYear?: unknown };
  const fromYear = eraYearOf(rec.fromYear);
  const toYear = eraYearOf(rec.toYear);
  if (!validEraYear(fromYear) || !validEraYear(toYear)) return null;
  if (fromYear == null && toYear == null) return null;
  if (fromYear != null && toYear != null && fromYear > toYear) return null;
  return { fromYear, toYear };
}

// Trimmed strings only, deduped in first-seen order, capped — the lenient twin
// of showStringList: where the schema REJECTS (a non-string entry, an
// over-cap list), this drops or truncates instead.
export function repairShowStringList(
  raw: unknown,
  opts: { max: number; itemMax?: number; values?: readonly string[]; key?: (v: string) => string },
): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const v = opts.itemMax ? item.trim().slice(0, opts.itemMax) : item.trim();
    if (!v) continue;
    if (opts.values && !opts.values.includes(v)) continue;
    const k = opts.key ? opts.key(v) : v;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= opts.max) break;
  }
  return out;
}

/**
 * Every per-field repair the load path applies before parsing, in one place.
 *
 * `undefined` lets the schema's own default apply. Each repair lands on a value
 * the strict path would have accepted, so load and save still agree about what
 * a valid show is — the schema itself is still run on the result.
 *
 * `personaIds: null` mirrors the ShowSchemaContext convention: this caller
 * cannot check roster membership, so guest entries are kept. The load path
 * passes the real roster and dangling guests (and the host itself) are dropped
 * so the show survives with whatever roster is still real.
 *
 * maxTrackSeconds is deliberately NOT repaired here: its clamp bounds are owned
 * by settings/defaults.ts (coerceMaxTrackSeconds), which already reads its
 * ceiling from this module's SHOW_MAX_TRACK_SECONDS.
 */
export function repairShowForLoad(
  raw: Record<string, unknown>,
  personaIds: string[] | null,
): Record<string, unknown> {
  const host = typeof raw.personaId === 'string' ? raw.personaId : '';
  return {
    ...raw,
    id: typeof raw.id === 'string' && SHOW_ID_RE.test(raw.id) ? raw.id : undefined,
    name: typeof raw.name === 'string' ? raw.name.trim().slice(0, SHOW_NAME_MAX) : undefined,
    topic: typeof raw.topic === 'string' ? raw.topic.slice(0, SHOW_TOPIC_MAX) : undefined,
    segmentSkill: typeof raw.segmentSkill === 'string'
      ? raw.segmentSkill.trim().slice(0, SHOW_SEGMENT_SKILL_MAX)
      : undefined,
    themeId: typeof raw.themeId === 'string'
      ? raw.themeId.trim().slice(0, SHOW_THEME_ID_MAX)
      : undefined,
    // Anything unrecognised reads as no constraint — a steering field that
    // silently stops applying is a far smaller failure than a show that stops
    // playing music.
    vocals: typeof raw.vocals === 'string' && (SHOW_VOCALS as readonly string[]).includes(raw.vocals)
      ? raw.vocals
      : undefined,
    // A stale mood costs the show that one filter, not the show. Moods are NOT
    // filtered against a vocabulary here for the same reason the load context
    // carries moodNames: null — the mood cache doesn't exist yet.
    moods: repairShowStringList(raw.moods, { max: SHOW_FILTER_VALUES_MAX }),
    genres: repairShowStringList(raw.genres, {
      max: SHOW_FILTER_VALUES_MAX,
      itemMax: SHOW_GENRE_MAX,
      key: (v) => v.toLowerCase(),
    }),
    energies: repairShowStringList(raw.energies, {
      max: SHOW_FILTER_VALUES_MAX,
      values: SHOW_ENERGY,
    }),
    eras: Array.isArray(raw.eras)
      ? raw.eras
          .map(repairEraWindow)
          .filter((w): w is EraWindow => w != null)
          .slice(0, SHOW_FILTER_VALUES_MAX)
      : undefined,
    guestPersonaIds: Array.isArray(raw.guestPersonaIds)
      ? raw.guestPersonaIds
          .filter((g): g is string =>
            typeof g === 'string' && g !== host && (personaIds == null || personaIds.includes(g)))
          .slice(0, GUESTS_PER_SHOW)
      : undefined,
    playlistIds: repairShowStringList(raw.playlistIds, { max: PLAYLISTS_PER_SHOW }),
    excludedPlaylistIds: repairShowStringList(raw.excludedPlaylistIds, {
      max: EXCLUDED_PLAYLISTS_PER_SHOW,
    }),
  };
}

// ─── from controller/src/schemas/skill.ts ────────────────────────────────

// Shared skill schema — the operator-editable half of a skill (its SKILL.md
// frontmatter + brief), executed on BOTH sides. The controller runs it in
// routes/dj.ts for create, custom-edit, built-in-edit and community-install;
// the browser runs the mirrored copy (web/lib/schemas.generated.ts) in the
// skill editor.
//
// HARD RULE: this file may import ONLY from 'zod'. It is copied verbatim into
// the web bundle, so a project import or a node builtin here breaks the mirror.
// Enforced by controller/eslint.config.mjs and by gen-schemas.ts.
//
// What is deliberately NOT here: the knobs a skill declares for itself in its
// tool.mjs (`configFields`). Those are RUNTIME data — the declaration arrives
// from an imported module, not from the request — and skills/config-fields.ts
// already owns their parse/coerce rules. That also means a skill-file body is
// NOT a closed shape: the fixed fields below are validated here, and the raw
// body still travels on to the declared-knob pass. A `z.object` would strip
// those keys, which is the same silent-drop the shows conversion hit.

// Custom-skill slug: lowercase, starts alphanumeric, then alphanumeric/hyphen,
// ≤49 chars. Anchored, so it can't contain '/', '.', or whitespace — the admin
// routes rely on that to keep a slug from escaping state/skills/.
//
// Homed here rather than in skills/loader.ts (which re-exports it as SLUG_RE,
// so no call site moved) because it was already hand-copied into the web
// editor. settings/vocab.ts's SKILL_SLUG_RE — the shape check on a persona's
// `skills[]` entries — is now an alias of this one too; it used to be a
// SEPARATE pattern (`/^[a-z0-9-]{1,40}$/`) that disagreed in both directions:
// it accepted `-nope`, which no skill can be called, and rejected a real
// 41–49-char slug, so a legitimately-named skill could not be assigned to a
// persona.
export const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;

// Freeform organisation tags (`tags: late-night, factual`) — operator
// vocabulary for filtering the admin skill list.
export const SKILL_TAG_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const TAGS_PER_SKILL_LIMIT = 8;

// "90m" | "6h" | "2d" | "45s" | "45" (bare = minutes). The loader parses the
// same shapes; an empty value means "use the default".
export const SKILL_COOLDOWN_RE = /^\d+\s*[smhd]?$/;

// A skill may declare an env var it needs before it can fire (`requiresKey`).
export const SKILL_ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

// When a custom skill may air. 'commute' restricts it to the commute hours;
// 'any' is the default and is NOT written to frontmatter.
export const SKILL_WINDOWS = ['any', 'commute'] as const;
export type SkillWindow = (typeof SKILL_WINDOWS)[number];

// The "right now" context vocabulary a segment may weave in (#471). Homed here
// because it is validated on both sides: the controller checks a submitted
// `context:` list against it, and the editor renders one chip per entry. The
// web copy was a hand-maintained CONTEXT_FIELDS_FALLBACK array; llm's
// prompts/context.ts re-exports this one, so there is a single vocabulary.
export const CONTEXT_FIELDS = ['date', 'clock', 'time', 'weather', 'festival', 'show', 'listeners'] as const;
export type ContextField = (typeof CONTEXT_FIELDS)[number];

// Lenient counterpart to skillTagsSchema, for tags read off a hand-edited
// SKILL.md (skills/loader.ts re-exports it as parseTags). Same rules, opposite
// posture: an invalid tag is DROPPED rather than refused, because a frontmatter
// typo should cost the skill a filter chip, not stop it loading. Living beside
// the strict schema is what keeps the two from drifting.
export function normalizeSkillTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  const out: string[] = [];
  for (const item of list) {
    const tag = String(item ?? '').trim().toLowerCase();
    if (!SKILL_TAG_RE.test(tag) || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= TAGS_PER_SKILL_LIMIT) break;
  }
  return out;
}

// Comma-string OR array — both wire shapes the admin form and the community
// catalog have always sent. Tokens are trimmed + lowercased; empties dropped.
function skillTokenList(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  return list.map((s) => String(s ?? '').trim().toLowerCase()).filter(Boolean);
}

// Messages carry no field name: firstMessage() prefixes the dotted path
// (`cooldown: must look like …`), so restating it here reads twice.

// Explicit null reads as "absent" on every optional field — the hand-rolled
// builders these schemas replaced read `typeof b.cooldown === 'string' ? … :
// ''`, so a client PUTting `cooldown: null` has always meant "use the
// default". zod's .optional() accepts only undefined, so without this a null
// would 400 an edit that used to save cleanly. (Named per-module: the mirror
// is one flat file, so this can't share show.ts's nullToUndefined.)
const skillNullToUndefined = (v: unknown) => (v == null ? undefined : v);

export const skillSlugSchema = z
  .string({ error: 'name must be a lowercase slug (a–z, 0–9, hyphens), 1–49 chars' })
  .trim()
  .toLowerCase()
  .regex(SKILL_SLUG_RE, 'must be a lowercase slug (a–z, 0–9, hyphens), 1–49 chars');

// Optional display name. NOTE this now REJECTS a non-string where the
// hand-rolled builder silently ignored it (`typeof b.label === 'string' && …`),
// the same call the webhook conversion made: a value dropped on the floor is a
// value the operator watches disappear on the next reload.
const skillLabelSchema = z.preprocess(
  skillNullToUndefined,
  z
    .string({ error: 'must be text' })
    .trim()
    .optional()
    .transform((v) => v || undefined),
);

const skillCooldownSchema = z.preprocess(
  skillNullToUndefined,
  z
    .string({ error: 'must be text' })
    .trim()
    .optional()
    .refine(
      (v) => !v || SKILL_COOLDOWN_RE.test(v),
      'must look like "45m", "6h", "2d", or a bare number (minutes)',
    )
    .transform((v) => v || undefined),
);

// An EMPTY selection is meaningful: it resets the skill to the default context
// profile, so [] and '' both land on undefined (no `context:` line written).
const skillContextSchema = z
  .union([z.null(), z.array(z.unknown()), z.string()])
  .optional()
  .transform((v) => (v == null ? undefined : skillTokenList(v)))
  .check((c) => {
    const toks = c.value;
    if (!toks) return;
    const bad = toks.filter((t) => !(CONTEXT_FIELDS as readonly string[]).includes(t));
    if (bad.length) {
      c.issues.push({
        code: 'custom',
        input: c.value,
        message: `unknown context field(s): ${bad.join(', ')} — valid: ${CONTEXT_FIELDS.join(', ')}`,
      });
    }
  })
  .transform((toks) => (toks && toks.length ? toks : undefined));

// Strict tags — a bad tag 400s instead of vanishing. The lenient
// normalizeSkillTags above is the disk-side twin.
export const skillTagsSchema = z
  .union([z.null(), z.array(z.unknown()), z.string()])
  .optional()
  .transform((v) => (v == null ? undefined : skillTokenList(v)))
  .check((c) => {
    const toks = c.value;
    if (!toks) return;
    for (const tag of toks) {
      if (!SKILL_TAG_RE.test(tag)) {
        c.issues.push({
          code: 'custom',
          input: c.value,
          message: `invalid tag "${tag}" — lowercase slugs (a-z, 0-9, hyphens), max 24 chars`,
        });
      }
    }
    if (new Set(toks).size > TAGS_PER_SKILL_LIMIT) {
      c.issues.push({
        code: 'custom',
        input: c.value,
        message: `at most ${TAGS_PER_SKILL_LIMIT} tags per skill`,
      });
    }
  })
  .transform((toks) => {
    if (!toks) return undefined;
    const out: string[] = [];
    for (const t of toks) if (!out.includes(t)) out.push(t);
    return out.length ? out : undefined;
  });

const skillBriefSchema = z
  .string({ error: 'a brief is required — what the DJ says, and when to stay quiet' })
  .trim()
  .min(1, 'a brief is required — what the DJ says, and when to stay quiet');

// 'any' is the default and writes no frontmatter line, so it lands on
// undefined exactly like an absent value.
const skillWindowSchema = z.preprocess(
  skillNullToUndefined,
  z
    .string({ error: 'must be "any" or "commute"' })
    .trim()
    .toLowerCase()
    .optional()
    .refine(
      (v) => v === undefined || (SKILL_WINDOWS as readonly string[]).includes(v),
      'must be "any" or "commute"',
    )
    .transform((v) => (v === 'commute' ? ('commute' as const) : undefined)),
);

const skillRequiresKeySchema = z.preprocess(
  skillNullToUndefined,
  z
    .string({ error: 'must be an env var name (UPPER_SNAKE_CASE)' })
    .trim()
    .optional()
    .refine(
      (v) => !v || SKILL_ENV_KEY_RE.test(v),
      'must be an env var name (UPPER_SNAKE_CASE)',
    )
    .transform((v) => v || undefined),
);

// The fields every skill's SKILL.md carries, built-in or custom.
export const builtinSkillFileSchema = z.object({
  label: skillLabelSchema,
  cooldown: skillCooldownSchema,
  context: skillContextSchema,
  tags: skillTagsSchema,
  brief: skillBriefSchema,
});

// A custom skill owns two more: it declares its own airing window and its own
// env-var gate. A built-in's are fixed by its shipped template, which is why
// the built-in edit route has never read them off the body.
export const customSkillFileSchema = builtinSkillFileSchema.extend({
  window: skillWindowSchema,
  requiresKey: skillRequiresKeySchema,
});

/** The right schema for this skill: custom skills carry window + requiresKey. */
export function skillFileSchema(custom: boolean) {
  return custom ? customSkillFileSchema : builtinSkillFileSchema;
}

// Create adds the slug, which is the skill's immutable identity (edit takes it
// from the URL instead).
export const skillCreateSchema = customSkillFileSchema.extend({
  name: skillSlugSchema,
});

export type SkillFileInput = z.input<typeof customSkillFileSchema>;
export type SkillFileParsed = z.output<typeof builtinSkillFileSchema> &
  Partial<z.output<typeof customSkillFileSchema>>;

/**
 * Parsed body → the field object writeSkillFile consumes. The only real work
 * is the `context` → `contextFields` rename; it lives here so the create,
 * custom-edit, built-in-edit and community-install paths can't each pick a
 * slightly different mapping (they used to, and the built-in branch was a
 * 35-line copy of the custom one).
 */
export function skillFieldsFrom(kind: string, parsed: SkillFileParsed) {
  return {
    kind,
    label: parsed.label,
    cooldown: parsed.cooldown,
    contextFields: parsed.context,
    window: parsed.window,
    requiresKey: parsed.requiresKey,
    tags: parsed.tags,
    brief: parsed.brief,
  };
}

// ─── from controller/src/schemas/station.ts ──────────────────────────────

// Shared station-profile schema — the single source of truth for the multi-
// station create/rename request shapes, executed on BOTH sides. The controller
// runs it in middleware/validate.ts at the route boundary AND inside
// stations/manager.ts (the persistence chokepoint, reachable without a route);
// the browser runs the mirrored copy (web/lib/schemas.generated.ts) as the
// form resolver.
//
// HARD RULE: this file may import ONLY from 'zod'. It is copied verbatim into
// the web bundle, so a project import or a node builtin here breaks the mirror.
// Enforced by controller/eslint.config.mjs and by gen-schemas.ts.
//
// Rules that are NOT pure functions of one value — resolving a slug against
// the ids already on disk, counting the rack against the cap — deliberately
// live in station-server.ts, which is NOT mirrored.

// Station id = directory name under state/stations/. Also the containment
// guard's first line of defence (no dots, no slashes, no uppercase).
//
// Lives here rather than in stations/pure.ts (which re-exports it) because
// slugifyStationName below is part of the mirror and depends on it: the admin
// UI's slug preview used to be a hand-copied second implementation, and it had
// already drifted — it omitted the fallback, so a name of pure punctuation
// previewed an empty slug while the server minted `station`.
export const STATION_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

// Hard ceiling on stations per install. Each station is a full state dir
// (own library.db, jingles, archive), so the cap keeps a runaway "new
// station" habit from silently eating the disk. Enforced in
// manager.createStation and surfaced to the UI via GET /stations `limit`.
export const MAX_STATIONS = 8;

// Display-name ceiling. Not the id length (that's STATION_ID_RE's 41) — the
// name is free text on the identity card and the slug is derived from it.
export const STATION_NAME_MAX = 80;

export function slugifyStationName(name: string): string {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 41)
    .replace(/-+$/g, '');
  return STATION_ID_RE.test(slug) ? slug : 'station';
}

// Carries its own messages: zod's built-in text is written for a developer
// ("Too small: expected string to have >=1 characters") and these strings
// reach an operator, both in a toast and under the input.
//
// NOTE this REJECTS an over-long name where the hand-rolled validator silently
// truncated it at 80 (`.trim().slice(0, 80)`). Same call as the webhook
// conversion made on authHeader: a name quietly cut in half is a station the
// operator has to notice and rename, whereas a rejection says so at the input
// with the schema running client-side, before a request is even sent.
export const stationNameSchema = z
  .string({ error: 'Station name is required' })
  .trim()
  .min(1, 'Station name is required')
  .max(STATION_NAME_MAX, `Station name must be ${STATION_NAME_MAX} characters or fewer`);

// Fresh = empty station, runs onboarding on first air. Duplicate = inherits the
// live station's identity/config, starts fresh history.
export const STATION_CREATE_MODES = ['fresh', 'duplicate'] as const;

export type StationCreateMode = (typeof STATION_CREATE_MODES)[number];

export const stationCreateSchema = z.object({
  name: stationNameSchema,
  // Absent still means 'fresh', as it did before. An UNRECOGNISED mode is now a
  // 400 rather than being coerced to fresh by `mode === 'duplicate' ? … : …` —
  // silently creating an empty station when the operator asked to duplicate one
  // is the expensive direction to be wrong, and no client sends a third value.
  mode: z.enum(STATION_CREATE_MODES, { error: 'Pick fresh or duplicate' }).default('fresh'),
});

export type StationCreate = z.output<typeof stationCreateSchema>;

// Rename is display-name only — the slug and data folder stay put — so it
// shares the name rule and nothing else.
export const stationRenameSchema = z.object({ name: stationNameSchema });

// ─── from controller/src/schemas/webhook.ts ──────────────────────────────

// Shared webhook schema — the single source of truth for the outbound-webhook
// shape, executed on BOTH sides. The controller runs it in
// settings.validate.validateWebhooksStrict() and in the route middleware; the
// browser runs the mirrored copy (web/lib/schemas.generated.ts) as the form
// resolver.
//
// HARD RULE: this file may import ONLY from 'zod'. It is copied verbatim into
// the web bundle, so a project import or a node builtin here breaks the mirror.
// Enforced by controller/eslint.config.mjs.
//
// Rules that are NOT pure functions of one value — the authHeader redaction
// sentinel, id minting, cross-item id de-duplication — deliberately live in
// webhook-server.ts, which is NOT mirrored.

// Event names the outbound webhook fan-out can subscribe to. This is now the
// ONE definition; settings/vocab.ts and broadcast/webhooks.ts re-export it.
export const WEBHOOK_EVENTS = [
  'track.play',          // a track started playing
  'dj.say',              // station ID / weather / hourly — heavy-ducked voice
  'dj.link',              // between-track auto-DJ link — light-ducked voice
  'request.received',    // a listener submitted a request
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOKS_LIMIT = 16;

// Exported because the LENIENT load-path normaliser (settings/normalize.ts)
// tests ids against it too. Two copies of this pattern would mean an id that is
// valid at boot and invalid on the next save — exactly the drift this shared
// module exists to remove. Named for its feature, not `ID_RE`: the mirror is one
// flat file, so every top-level name here shares a scope with every other
// schema module's.
export const WEBHOOK_ID_RE = /^[a-z0-9_]{3,32}$/;

export const webhookSchema = z.object({
  // Optional because a brand-new row has no id yet — the server mints one.
  // Carries its own message for the same reason url does: zod's built-in
  // regex/length text is written for a developer ("Invalid string: must match
  // pattern /^[a-z0-9_]{3,32}$/") and this string reaches an operator's toast.
  id: z
    .string()
    .regex(WEBHOOK_ID_RE, 'id must be 3-32 characters: lowercase letters, digits or underscores')
    .optional(),
  url: z
    .string()
    .trim()
    .max(500, 'URL must be 500 characters or fewer')
    .regex(/^https?:\/\//, 'URL must start with http:// or https://'),
  events: z
    .array(z.enum(WEBHOOK_EVENTS), { error: 'Pick at least one event' })
    .min(1, 'Pick at least one event')
    .transform((xs) => [...new Set(xs)]),
  enabled: z.boolean().default(true),
  // '' means no header. The literal 'set' is the redaction sentinel from
  // settings.getRedacted() meaning "keep whatever is stored" — resolving it
  // needs the CURRENT list, so see mergeWebhookSecrets() in webhook-server.ts.
  authHeader: z
    .string()
    .max(500, 'Authorization header must be 500 characters or fewer')
    .default(''),
});

export type WebhookParsed = z.output<typeof webhookSchema>;
export type Webhook = WebhookParsed & { id: string };

export const webhooksSchema = z
  .array(webhookSchema)
  .max(WEBHOOKS_LIMIT, `At most ${WEBHOOKS_LIMIT} webhooks`);

// Both fields optional: the route lets the listener gate save on its own
// without re-submitting (and re-validating) the hook list, and vice versa.
export const webhooksPatchSchema = z.object({
  webhooks: webhooksSchema.optional(),
  trackPlayListenerGated: z.boolean().optional(),
});
