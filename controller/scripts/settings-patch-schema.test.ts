// The /settings mega-endpoint on the shared zod schemas (#1348, split out of
// #1337). This first slice lands the per-key registry, the fieldErrors channel,
// and the imaging toggles (jingleRatio / sfx / beds) that #1337 left half
// converted.
//
// What these tests are really guarding is FIDELITY. The branches being replaced
// carry a lot of accidental leniency — parseInt truncating a float, `!!` taking
// any truthy value, `patch.beds || {}` swallowing a non-object — and #1337's
// rule is that no conversion may turn a silent repair into a refusal or the
// reverse. Every "still accepts" test below is a behaviour that would break if
// someone swapped these schemas for the obvious z.number().int() / z.boolean().
//
// Run: npx tsx scripts/settings-patch-schema.test.ts (auto-discovered by npm test).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-settings-patch-'));

const {
  BEDS_CROSS_SEC_BOUNDS,
  BEDS_THRESHOLD_SEC_BOUNDS,
  JINGLE_RATIO_BOUNDS,
  bedsPatchSchema,
  jingleRatioSchema,
  sfxPatchSchema,
} = await import('../src/schemas/settings.js');
const {
  SETTINGS_PATCH_KEYS,
  SETTINGS_PATCH_SCHEMAS,
  parseSettingsPatchKey,
  validateSettingsPatch,
} = await import('../src/settings/patch-registry.js');
const { BOUNDS, DEFAULTS } = await import('../src/settings/defaults.js');
const { validateSettingsBody } = await import('../src/middleware/validate.js');
const settings = await import('../src/settings.js');

// Minimal express doubles — enough to see what the middleware answers.
function runMiddleware(body: unknown) {
  const captured: { status?: number; json?: unknown; nexted: boolean } = { nexted: false };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.json = payload;
      return this;
    },
  };
  validateSettingsBody()(
    { body } as never,
    res as never,
    () => {
      captured.nexted = true;
    },
  );
  return captured;
}

// The exact strings the hand-rolled branches produced. Hardcoded rather than
// built from BOUNDS, because the point is that the operator-facing text did not
// change — deriving them from the same constants the schema uses would let both
// drift together and still pass.
const JINGLE_MSG = 'jingleRatio must be int in [0, 1000]';
const THRESHOLD_MSG = 'beds.thresholdSec must be number in [0, 60]';
const CROSS_MSG = 'beds.crossSec must be number in [0, 15]';

// --- fidelity: the silent repairs that must survive -------------------------

test('jingleRatio still parses the string forms an older admin build posts', () => {
  assert.equal(jingleRatioSchema.parse('5'), 5);
  assert.equal(jingleRatioSchema.parse('  5  '), 5);
  assert.equal(jingleRatioSchema.parse(5), 5);
});

test('jingleRatio still TRUNCATES a float instead of refusing it', () => {
  // parseInt(5.7, 10) === 5. z.number().int() would refuse — that is the swap
  // this test exists to catch.
  assert.equal(jingleRatioSchema.parse(5.7), 5);
  assert.equal(jingleRatioSchema.parse('5.7'), 5);
});

test('jingleRatio still reads a leading integer out of junk', () => {
  assert.equal(jingleRatioSchema.parse('5abc'), 5);
});

test('jingleRatio refuses what it always refused, with the same message', () => {
  for (const bad of ['abc', '', null, undefined, true, {}, [], NaN, Infinity]) {
    assert.equal(jingleRatioSchema.safeParse(bad).success, false, `accepted ${String(bad)}`);
  }
  assert.equal(jingleRatioSchema.safeParse(JINGLE_RATIO_BOUNDS.max + 1).success, false);
  assert.equal(jingleRatioSchema.safeParse(JINGLE_RATIO_BOUNDS.min - 1).success, false);
  assert.equal(jingleRatioSchema.safeParse(1001).error?.issues[0]?.message, JINGLE_MSG);
});

test('jingleRatio accepts both ends of the range', () => {
  assert.equal(jingleRatioSchema.parse(JINGLE_RATIO_BOUNDS.min), 0);
  assert.equal(jingleRatioSchema.parse(JINGLE_RATIO_BOUNDS.max), 1000);
});

test('a block toggle still coerces any truthy value, like `!!` did', () => {
  // Reached by backup restore, which posts a whole (possibly hand-edited)
  // settings.json. z.boolean() here would fail the entire restore over a `1`.
  assert.equal(sfxPatchSchema.parse({ enabled: 1 }).enabled, true);
  assert.equal(sfxPatchSchema.parse({ enabled: 'yes' }).enabled, true);
  assert.equal(sfxPatchSchema.parse({ enabled: 0 }).enabled, false);
  assert.equal(sfxPatchSchema.parse({ enabled: null }).enabled, false);
  assert.equal(sfxPatchSchema.parse({ enabled: true }).enabled, true);
});

test('a non-object block is an empty patch, not an error', () => {
  // `patch.sfx || {}` followed by `sx.enabled !== undefined` no-ops on all of
  // these today.
  for (const raw of [null, undefined, 0, '', false, 'nonsense', 42, []]) {
    const r = sfxPatchSchema.safeParse(raw);
    assert.equal(r.success, true, `refused ${JSON.stringify(raw)}`);
    assert.deepEqual(r.data, {});
  }
});

test('an explicitly-undefined field is absent, not false', () => {
  // The branch tested `bd.enabled !== undefined`, so `{enabled: undefined}` left
  // the stored value alone. Writing `false` here would silently turn beds off.
  assert.equal('enabled' in bedsPatchSchema.parse({ enabled: undefined }), false);
  assert.deepEqual(bedsPatchSchema.parse({}), {});
});

test('unknown fields INSIDE a block are dropped, not refused', () => {
  // Same reason unknown top-level keys are refused only at the route: a backup
  // from a newer version carries block fields this one has never heard of.
  const r = bedsPatchSchema.safeParse({ enabled: true, futureKnob: 3 });
  assert.equal(r.success, true);
  assert.deepEqual(r.data, { enabled: true });
});

test('beds numbers still parse strings and refuse out-of-range, same messages', () => {
  assert.equal(bedsPatchSchema.parse({ thresholdSec: '12.5' }).thresholdSec, 12.5);
  assert.equal(bedsPatchSchema.parse({ crossSec: '6' }).crossSec, 6);
  assert.equal(bedsPatchSchema.parse({ thresholdSec: 0 }).thresholdSec, 0);

  const over = bedsPatchSchema.safeParse({ thresholdSec: BEDS_THRESHOLD_SEC_BOUNDS.max + 1 });
  assert.equal(over.success, false);
  assert.equal(over.error?.issues[0]?.message, THRESHOLD_MSG);

  const cross = bedsPatchSchema.safeParse({ crossSec: BEDS_CROSS_SEC_BOUNDS.max + 1 });
  assert.equal(cross.success, false);
  assert.equal(cross.error?.issues[0]?.message, CROSS_MSG);

  assert.equal(bedsPatchSchema.safeParse({ crossSec: -1 }).success, false);
  assert.equal(bedsPatchSchema.safeParse({ thresholdSec: 'abc' }).success, false);
});

test('BOUNDS still reports the same numbers now that the schema owns them', () => {
  // BOUNDS is re-exported from schemas/settings.ts rather than declaring its
  // own copy. Consumers (radio.liq writers, the admin UI) must see no change.
  assert.deepEqual(BOUNDS.jingleRatio, { min: 0, max: 1000, type: 'int' });
  assert.deepEqual(BOUNDS.bedsThresholdSec, { min: 0, max: 60, type: 'float' });
  assert.deepEqual(BOUNDS.bedsCrossSec, { min: 0, max: 15, type: 'float' });
});

// --- the registry -----------------------------------------------------------

test('every settings key with defaults is in the patch inventory', () => {
  // An unlisted key is REJECTED at the route, so a key added to DEFAULTS and
  // update() but forgotten here would 400 the panel that saves it.
  const missing = Object.keys(DEFAULTS).filter((k) => !SETTINGS_PATCH_KEYS.includes(k as never));
  assert.deepEqual(missing, []);
});

test('the inventory carries the two keys the issue overlooked', () => {
  // Both are postable today: stationDescription is its own branch (not part of
  // `station`), and maxTrackMinutes is the legacy alias rawMaxTrackSec reads.
  assert.ok(SETTINGS_PATCH_KEYS.includes('stationDescription'));
  assert.ok(SETTINGS_PATCH_KEYS.includes('maxTrackMinutes'));
});

test('the inventory has no duplicates', () => {
  assert.equal(new Set(SETTINGS_PATCH_KEYS).size, SETTINGS_PATCH_KEYS.length);
});

test('every registered schema names its key in every message it can produce', () => {
  // The flat `error` string is the message VERBATIM, so operators keep reading
  // the exact strings they always have. That only holds while each message
  // names its own dotted field, which is the invariant this enforces —
  // structurally, over the whole registry, so a schema added later can't quietly
  // ship a bare zod message like 'expected number, received string'.
  const hostile: unknown[] = [
    99999, -1, 'abc', '', null, true, [], {}, NaN, Infinity,
    { enabled: 'x', thresholdSec: 999, crossSec: 999 },
    { thresholdSec: 'abc' },
    { crossSec: -1 },
  ];
  let sawFailure = false;
  for (const key of Object.keys(SETTINGS_PATCH_SCHEMAS)) {
    for (const value of hostile) {
      const failure = validateSettingsPatch({ [key]: value });
      if (!failure) continue;
      sawFailure = true;
      assert.ok(
        failure.error.startsWith(key),
        `${key} produced a message that does not name its field: ${failure.error}`,
      );
      for (const [path, message] of Object.entries(failure.fieldErrors)) {
        assert.ok(path.startsWith(key), `fieldErrors path not rooted at ${key}: ${path}`);
        assert.ok(message.startsWith(key), `fieldErrors message for ${path}: ${message}`);
      }
    }
  }
  assert.ok(sawFailure, 'hostile values produced no failures at all — test is vacuous');
});

test('parseSettingsPatchKey throws a plain Error, never a ZodError', () => {
  // update() answers `{ error: err.message }`, and a raw ZodError's .message is
  // a ~15-line pretty-printed JSON array.
  try {
    parseSettingsPatchKey('jingleRatio', 99999);
    assert.fail('expected a throw');
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.equal(err.constructor.name, 'Error');
    assert.equal(err.message, JINGLE_MSG);
    assert.ok(!err.message.includes('\n'));
  }
});

test('parseSettingsPatchKey passes an unconverted key straight through', () => {
  // The registry has to tolerate the 39 keys still on hand-rolled branches.
  const value = { anything: true };
  assert.equal(parseSettingsPatchKey('llm', value), value);
});

// --- the route posture ------------------------------------------------------

test('a valid patch passes', () => {
  assert.equal(validateSettingsPatch({ jingleRatio: 4, beds: { enabled: true } }), null);
  assert.equal(validateSettingsPatch({}), null);
});

test('an unconverted key is not judged', () => {
  // Its hand-rolled branch is still the authority; the route must not guess.
  assert.equal(validateSettingsPatch({ llm: { provider: 'nonsense' } }), null);
});

test('fieldErrors are dotted and rooted at the settings key', () => {
  const failure = validateSettingsPatch({ beds: { crossSec: 99 } });
  assert.ok(failure);
  assert.deepEqual(Object.keys(failure.fieldErrors), ['beds.crossSec']);
  assert.equal(failure.fieldErrors['beds.crossSec'], CROSS_MSG);
});

test('a scalar key maps to the bare key, not an empty path', () => {
  const failure = validateSettingsPatch({ jingleRatio: -1 });
  assert.ok(failure);
  assert.deepEqual(Object.keys(failure.fieldErrors), ['jingleRatio']);
});

test('every failing key reports, and the flat error follows BRANCH order', () => {
  // jingleRatio's branch runs before beds', so it owns the flat string — the
  // route and update() name the same problem regardless of JSON key order.
  const failure = validateSettingsPatch({ beds: { crossSec: 99 }, jingleRatio: -1 });
  assert.ok(failure);
  assert.equal(failure.error, JINGLE_MSG);
  assert.deepEqual(Object.keys(failure.fieldErrors).sort(), ['beds.crossSec', 'jingleRatio']);
});

test('unknown top-level keys are rejected and all of them are named', () => {
  const failure = validateSettingsPatch({ jingleRatioo: 4, bedz: {} });
  assert.ok(failure);
  assert.match(failure.error, /unknown settings keys: /);
  assert.deepEqual(Object.keys(failure.fieldErrors).sort(), ['bedz', 'jingleRatioo']);
});

test('a non-object body is refused', () => {
  for (const bad of [null, undefined, 'x', 5, []]) {
    assert.ok(validateSettingsPatch(bad), `accepted ${JSON.stringify(bad)}`);
  }
});

// --- the route middleware ---------------------------------------------------

test('middleware: a good patch calls next() and answers nothing', () => {
  const r = runMiddleware({ beds: { thresholdSec: 12 } });
  assert.equal(r.nexted, true);
  assert.equal(r.status, undefined);
});

test('middleware: a bad patch 400s with both error and fieldErrors', () => {
  const r = runMiddleware({ beds: { crossSec: 99 } });
  assert.equal(r.nexted, false);
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, {
    error: CROSS_MSG,
    fieldErrors: { 'beds.crossSec': CROSS_MSG },
  });
});

test('middleware: an absent body is an empty patch, not a crash', () => {
  // The route reads `req.body || {}`; express only populates it when a JSON
  // body was actually sent.
  assert.equal(runMiddleware(undefined).nexted, true);
});

test('middleware: does NOT rewrite the body', () => {
  // update() re-runs the same schemas as it applies each key and stays the
  // authoritative chokepoint — coercing here too would put two places in
  // charge of what gets stored.
  const body = { jingleRatio: '7' };
  runMiddleware(body);
  assert.equal(body.jingleRatio, '7');
});

// --- the chokepoint ---------------------------------------------------------

test('update() stores what the schema parsed, coercions included', async () => {
  const a = await settings.update({ jingleRatio: '7', sfx: { enabled: 1 } });
  assert.equal(a.saved.jingleRatio, 7);
  assert.equal(a.saved.sfx.enabled, true);
  // A ratio change still asks for the mixer restart the schema knows nothing
  // about — applying a value and validating it stayed separate concerns.
  assert.equal(a.requiresRestart, true);

  const b = await settings.update({ beds: { thresholdSec: '9.5', crossSec: 3 } });
  assert.equal(b.saved.beds.thresholdSec, 9.5);
  assert.equal(b.saved.beds.crossSec, 3);
});

test('update() re-posting the same ratio asks for no restart', async () => {
  await settings.update({ jingleRatio: 7 });
  const again = await settings.update({ jingleRatio: 7 });
  assert.equal(again.requiresRestart, false);
});

test('update() refuses a bad value with the pre-conversion message', async () => {
  await assert.rejects(() => settings.update({ jingleRatio: 99999 }), (err: Error) => {
    assert.equal(err.message, JINGLE_MSG);
    return true;
  });
  await assert.rejects(() => settings.update({ beds: { crossSec: 99 } }), (err: Error) => {
    assert.equal(err.message, CROSS_MSG);
    return true;
  });
});

test('update() still tolerates a key it has never heard of', async () => {
  // This is the half backup restore depends on: routes/backup.ts hands update()
  // a whole settings.json, and a key from a newer version must cost one setting
  // rather than the entire restore. Only the ROUTE rejects unknown keys.
  const before = (await settings.load()).jingleRatio;
  const r = await settings.update({ someKeyFromTheFuture: { nested: true } } as never);
  assert.equal(r.saved.jingleRatio, before);
});

test('the converted keys are exactly the ones with schemas', () => {
  assert.deepEqual(Object.keys(SETTINGS_PATCH_SCHEMAS).sort(), ['beds', 'jingleRatio', 'sfx']);
});
