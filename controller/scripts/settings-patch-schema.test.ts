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
  archivePatchSchema,
  audioPatchSchema,
  bedsPatchSchema,
  crossfadeDurationSchema,
  djHouseRulesSchema,
  jingleRatioSchema,
  likesPatchSchema,
  localeSchema,
  loudnessPatchSchema,
  scrobblePatchSchema,
  searchPatchSchema,
  sfxPatchSchema,
  stationDescriptionSchema,
  stationSchema,
  streamPatchSchema,
  transitionsPatchSchema,
  uiPatchSchema,
  weatherPatchSchema,
  webhooksPolicyPatchSchema,
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

test('no registered schema can leak a raw zod message', () => {
  // The flat `error` string is the message VERBATIM, so operators keep reading
  // the exact strings they always have. Most name a dotted field, but not all
  // do — 'station name must be 80 chars or fewer', 'search.baseUrl too long'
  // and "locale must be 'en-GB' or 'en-US'" are shipping strings that don't.
  // So the enforced rule is the weaker, TRUE one: every message is non-empty,
  // single-line, and is not one of zod's built-ins ('Invalid input: expected
  // …'), which is what a careless z.string()/z.number()/z.enum() would emit.
  const hostile: unknown[] = [
    99999, -1, 'abc', '', null, true, [], {}, NaN, Infinity, -0.5,
    { enabled: 'x', thresholdSec: 999, crossSec: 999 },
    { bitrate: 7, retentionDays: -1, bufferSeconds: 'x', opusBitrate: 1, aacBitrate: 1 },
    { targetLufs: 99, maxBoostDb: 99, source: 'nope' },
    { lat: 999, lng: 999, units: 'Metric' },
    { provider: 'nope', baseUrl: 5, apiKey: 'x'.repeat(500) },
    { stemCacheGb: 'x', analyzeQuietMinutes: 999 },
    { maxTracks: 99, windowDays: -9 },
    { lastfm: { username: 'x'.repeat(99) }, listenbrainz: { baseUrl: 'ftp://x' } },
    { idleAfterMinutes: 0 },
  ];
  let sawFailure = false;
  for (const key of Object.keys(SETTINGS_PATCH_SCHEMAS)) {
    for (const value of hostile) {
      const failure = validateSettingsPatch({ [key]: value });
      if (!failure) continue;
      sawFailure = true;
      const messages = [failure.error, ...Object.values(failure.fieldErrors)];
      for (const m of messages) {
        assert.ok(m && m.length > 0, `${key} produced an empty message`);
        assert.ok(!m.includes('\n'), `${key} produced a multi-line message: ${m}`);
        assert.ok(
          !/^Invalid input|^Invalid option|^Too big|^Too small|^Expected /.test(m),
          `${key} leaked a raw zod message: ${m}`,
        );
      }
      for (const path of Object.keys(failure.fieldErrors)) {
        assert.ok(path.startsWith(key), `fieldErrors path not rooted at ${key}: ${path}`);
      }
    }
  }
  assert.ok(sawFailure, 'hostile values produced no failures at all — test is vacuous');
});

// --- fidelity of the second slice ------------------------------------------
// One test per behaviour that the OBVIOUS conversion would have changed.

test('crossfadeDuration keeps parseFloat leniency and its message', () => {
  assert.equal(crossfadeDurationSchema.parse('10.5'), 10.5);
  assert.equal(crossfadeDurationSchema.parse('10.5 seconds'), 10.5);
  assert.equal(crossfadeDurationSchema.parse([10]), 10);
  assert.equal(
    crossfadeDurationSchema.safeParse(31).error?.issues[0]?.message,
    'crossfadeDuration must be number in [0, 30]',
  );
  assert.equal(crossfadeDurationSchema.safeParse(null).success, false);
});

test('archive.retentionDays keeps its EN DASH', () => {
  const msg = archivePatchSchema.safeParse({ retentionDays: -1 }).error?.issues[0]?.message;
  assert.equal(msg, 'archive.retentionDays must be 0 (keep forever) or 1–3650 days');
  // U+2013, not a hyphen. Retyping it changes the operator's toast.
  assert.ok(msg?.includes('–'));
  assert.ok(!msg?.includes('1-3650'));
});

test('archive.bitrate accepts the set, truncates a float into it, reads junk', () => {
  assert.equal(archivePatchSchema.parse({ bitrate: 128 }).bitrate, 128);
  assert.equal(archivePatchSchema.parse({ bitrate: '128' }).bitrate, 128);
  assert.equal(archivePatchSchema.parse({ bitrate: 128.9 }).bitrate, 128);
  assert.equal(archivePatchSchema.parse({ bitrate: '128kbps' }).bitrate, 128);
  assert.equal(archivePatchSchema.safeParse({ bitrate: 130 }).success, false);
});

test('stream.bufferSeconds uses Number(), not parseInt, and rounds AFTER the bounds test', () => {
  // '' / null / [] are 0 here (a legal "no burst") where parseInt gives NaN,
  // and '5abc' is refused where parseInt would accept 5. Both directions.
  assert.equal(streamPatchSchema.parse({ bufferSeconds: '' }).bufferSeconds, 0);
  assert.equal(streamPatchSchema.parse({ bufferSeconds: null }).bufferSeconds, 0);
  assert.equal(streamPatchSchema.safeParse({ bufferSeconds: '5abc' }).success, false);
  // Bounds on the UNROUNDED value: 59.6 passes and stores 60; 60.4 fails.
  assert.equal(streamPatchSchema.parse({ bufferSeconds: 59.6 }).bufferSeconds, 60);
  assert.equal(streamPatchSchema.safeParse({ bufferSeconds: 60.4 }).success, false);
  assert.equal(streamPatchSchema.parse({ bufferSeconds: 22.6 }).bufferSeconds, 23);
});

test('stream keeps its bitrate sets and idle bounds', () => {
  assert.equal(streamPatchSchema.parse({ opusBitrate: '192' }).opusBitrate, 192);
  assert.equal(streamPatchSchema.safeParse({ opusBitrate: 64 }).success, false);
  assert.equal(streamPatchSchema.safeParse({ aacBitrate: 320 }).success, false);
  assert.equal(streamPatchSchema.parse({ idleAfterMinutes: '10.9' }).idleAfterMinutes, 10);
  assert.equal(streamPatchSchema.safeParse({ idleAfterMinutes: 0 }).success, false);
  assert.equal(streamPatchSchema.parse({ flacEnabled: 'no' }).flacEnabled, true);
});

test('loudness.source is tested RAW — no trim, no case folding', () => {
  assert.equal(loudnessPatchSchema.parse({ source: 'measured' }).source, 'measured');
  assert.equal(loudnessPatchSchema.safeParse({ source: ' measured' }).success, false);
  assert.equal(loudnessPatchSchema.safeParse({ source: 'Measured' }).success, false);
  assert.equal(
    loudnessPatchSchema.safeParse({ source: 'x' }).error?.issues[0]?.message,
    'loudness.source must be one of: replaygain-then-measured, replaygain, measured',
  );
  assert.equal(loudnessPatchSchema.parse({ targetLufs: '-14.5' }).targetLufs, -14.5);
});

test('weather ignores a bad locationName instead of refusing it', () => {
  // Non-string and blank are DROPPED (the label can never be blanked); over-80
  // truncates. onAirLocation differs: '' IS accepted, to reset the fallback.
  assert.equal(weatherPatchSchema.parse({ locationName: 5 }).locationName, undefined);
  assert.equal(weatherPatchSchema.parse({ locationName: '   ' }).locationName, undefined);
  assert.equal(weatherPatchSchema.parse({ locationName: '  Leeds ' }).locationName, 'Leeds');
  assert.equal(weatherPatchSchema.parse({ locationName: 'x'.repeat(99) }).locationName?.length, 80);
  assert.equal(weatherPatchSchema.parse({ onAirLocation: '' }).onAirLocation, '');
  assert.equal(weatherPatchSchema.parse({ onAirLocation: 5 }).onAirLocation, undefined);
});

test('weather keeps its own message wording and raw units check', () => {
  assert.equal(
    weatherPatchSchema.safeParse({ lat: 91 }).error?.issues[0]?.message,
    'weather.lat out of range',
  );
  assert.equal(
    weatherPatchSchema.safeParse({ lng: 181 }).error?.issues[0]?.message,
    'weather.lng out of range',
  );
  assert.equal(weatherPatchSchema.parse({ lat: '51.5abc' }).lat, 51.5);
  assert.equal(weatherPatchSchema.safeParse({ units: 'Metric' }).success, false);
});

test('an emptied station name resolves to the product default', () => {
  assert.equal(stationSchema.parse(''), 'SUB/WAVE');
  assert.equal(stationSchema.parse('   '), 'SUB/WAVE');
  assert.equal(stationSchema.parse(null), 'SUB/WAVE');
  assert.equal(stationSchema.parse('  Night Loop  '), 'Night Loop');
  assert.equal(
    stationSchema.safeParse('x'.repeat(81)).error?.issues[0]?.message,
    'station name must be 80 chars or fewer',
  );
  // stationDescription has no such substitution — empty is a real value.
  assert.equal(stationDescriptionSchema.parse(''), '');
  assert.equal(stationDescriptionSchema.safeParse('x'.repeat(201)).success, false);
});

test('locale trims BEFORE the strict pair', () => {
  // settingsStrictOneOf tests the raw value, which is right for units/source
  // and wrong here — the branch coerces and trims first.
  assert.equal(localeSchema.parse(' en-GB '), 'en-GB');
  assert.equal(localeSchema.safeParse('en-gb').success, false);
  assert.equal(
    localeSchema.safeParse(null).error?.issues[0]?.message,
    "locale must be 'en-GB' or 'en-US'",
  );
});

test('search.baseUrl TYPE-checks where scrobble.listenbrainz.baseUrl coerces', () => {
  // Same shape, same message tail, different acceptance. Do not unify.
  assert.equal(searchPatchSchema.safeParse({ baseUrl: 5 }).success, false);
  assert.equal(
    searchPatchSchema.safeParse({ baseUrl: 5 }).error?.issues[0]?.message,
    'search.baseUrl must be a string',
  );
  assert.equal(scrobblePatchSchema.parse({ listenbrainz: { baseUrl: null } })
    .listenbrainz?.baseUrl, '');
  assert.equal(searchPatchSchema.safeParse({ baseUrl: 'ftp://x' }).success, false);
  // No trailing-slash strip on either — that consumer appends a path.
  assert.equal(searchPatchSchema.parse({ baseUrl: 'http://x/' }).baseUrl, 'http://x/');
});

test('search.apiKey stringifies null to "null" and does NOT trim', () => {
  // Not a good design, but the shipping one, and a secret field is the last
  // place to change storage behaviour by accident.
  assert.equal(searchPatchSchema.parse({ apiKey: null }).apiKey, 'null');
  assert.equal(searchPatchSchema.parse({ apiKey: '  k  ' }).apiKey, '  k  ');
  assert.equal(searchPatchSchema.safeParse({ apiKey: 'x'.repeat(201) }).success, false);
});

test('scrobble string fields clear on null (?? \'\'), unlike search.apiKey', () => {
  assert.equal(scrobblePatchSchema.parse({ lastfm: { username: null } }).lastfm?.username, '');
  assert.equal(scrobblePatchSchema.parse({ lastfm: { username: ' bob ' } }).lastfm?.username, 'bob');
  assert.equal(scrobblePatchSchema.safeParse({ lastfm: { username: 'x'.repeat(41) } }).success, false);
  assert.equal(
    scrobblePatchSchema.safeParse({ lastfm: { apiKey: 'x'.repeat(201) } }).error?.issues[0]?.message,
    'scrobble.lastfm.apiKey must be 0-200 chars',
  );
  // A non-object sub-block is an empty patch, not an error.
  assert.deepEqual(scrobblePatchSchema.parse({ lastfm: 'nonsense' }).lastfm, {});
});

test('audio.stemCacheGb keeps a float; analyzeQuietMinutes floors', () => {
  assert.equal(audioPatchSchema.parse({ stemCacheGb: 15.5 }).stemCacheGb, 15.5);
  assert.equal(audioPatchSchema.parse({ stemCacheGb: true }).stemCacheGb, 1);
  // Number(), not parseInt — '10abc' is refused here where a parseInt field
  // would have accepted 10.
  assert.equal(audioPatchSchema.safeParse({ stemCacheGb: '10abc' }).success, false);
  assert.equal(audioPatchSchema.safeParse({ stemCacheGb: null }).success, false);
  assert.equal(audioPatchSchema.parse({ analyzeQuietMinutes: 10.9 }).analyzeQuietMinutes, 10);
  assert.equal(audioPatchSchema.safeParse({ analyzeQuietMinutes: 0.5 }).success, false);
});

test('likes rounds BEFORE the bounds test, which moves values across a bound', () => {
  // 0.6 -> 1 accepted, 0.4 -> 0 refused, 25.4 accepted, 25.5 refused.
  // z.number().int().min(1).max(25) refuses all four.
  assert.equal(likesPatchSchema.parse({ maxTracks: 0.6 }).maxTracks, 1);
  assert.equal(likesPatchSchema.safeParse({ maxTracks: 0.4 }).success, false);
  assert.equal(likesPatchSchema.parse({ maxTracks: 25.4 }).maxTracks, 25);
  assert.equal(likesPatchSchema.safeParse({ maxTracks: 25.5 }).success, false);
  assert.equal(likesPatchSchema.parse({ windowDays: 0 }).windowDays, 0);
  assert.equal(
    likesPatchSchema.safeParse({ windowDays: 999 }).error?.issues[0]?.message,
    'likes.windowDays must be 0-365 (0 = all time)',
  );
});

test('ui.skin is DROPPED when invalid, and stringifies non-strings', () => {
  assert.equal(uiPatchSchema.parse({ skin: 'Classic' }).skin, 'classic');
  assert.equal(uiPatchSchema.parse({ skin: '  classic ' }).skin, 'classic');
  // String(null) is 'null', which matches the slug pattern and is stored today.
  assert.equal(uiPatchSchema.parse({ skin: null }).skin, 'null');
  assert.equal(uiPatchSchema.parse({ skin: 7 }).skin, '7');
  // Non-matching is dropped, and the patch still SUCCEEDS.
  assert.equal(uiPatchSchema.parse({ skin: '-bad' }).skin, undefined);
  assert.equal(uiPatchSchema.parse({ skin: 'a'.repeat(33) }).skin, undefined);
  assert.equal(uiPatchSchema.parse({ skin: {} }).skin, undefined);
  assert.equal(uiPatchSchema.safeParse({ skin: '-bad' }).success, true);
});

test('the never-throwing blocks still never throw', () => {
  // ui, transitions and webhooksPolicy have no refusal path at all today.
  for (const v of [{ pairDrain: 'x' }, { stemBlends: 0 }, 'nonsense', null, []]) {
    assert.equal(transitionsPatchSchema.safeParse(v).success, true);
  }
  for (const v of [{ trackPlayListenerGated: 'x' }, 'nonsense', null]) {
    assert.equal(webhooksPolicyPatchSchema.safeParse(v).success, true);
  }
  assert.equal(uiPatchSchema.safeParse({ boothBuddy: 'x', tuneInOverlay: 0 }).success, true);
  assert.equal(transitionsPatchSchema.parse({ pairDrain: 'x' }).pairDrain, true);
});

test('djHouseRules caps at 2000 and coerces', () => {
  assert.equal(djHouseRulesSchema.parse(null), '');
  assert.equal(djHouseRulesSchema.parse('  spell out numbers  '), 'spell out numbers');
  assert.equal(
    djHouseRulesSchema.safeParse('x'.repeat(2001)).error?.issues[0]?.message,
    'djHouseRules must be at most 2000 chars',
  );
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
  // The remaining keys are documented in CLAUDE.md with the reason each one
  // resists a stateless schema (clamps that fall back to the CURRENT value,
  // post-merge cross-field rules, write-throughs into another key).
  assert.deepEqual(Object.keys(SETTINGS_PATCH_SCHEMAS).sort(), [
    'archive', 'audio', 'beds', 'crossfadeDuration', 'djHouseRules', 'jingleRatio',
    'likes', 'locale', 'loudness', 'scrobble', 'search', 'sfx', 'station',
    'stationDescription', 'stream', 'transitions', 'ui', 'weather', 'webhooksPolicy',
  ]);
});

test('update() round-trips the second slice, coercions and restarts intact', async () => {
  const a = await settings.update({
    crossfadeDuration: '8.5',
    station: '   ',
    locale: ' en-US ',
    loudness: { source: 'measured', targetLufs: '-15' },
    likes: { maxTracks: 0.6 },
    audio: { stemCacheGb: 15.5 },
    ui: { skin: 'Classic', boothBuddy: 1 },
  });
  assert.equal(a.saved.crossfadeDuration, 8.5);
  assert.equal(a.saved.station, 'SUB/WAVE'); // emptied -> product default
  assert.equal(a.saved.locale, 'en-US');
  assert.equal(a.saved.loudness.source, 'measured');
  assert.equal(a.saved.loudness.targetLufs, -15);
  assert.equal(a.saved.likes.maxTracks, 1);
  assert.equal(a.saved.stemCacheGb ?? a.saved.audio.stemCacheGb, 15.5);
  assert.equal(a.saved.ui.skin, 'classic');
  assert.equal(a.saved.ui.boothBuddy, true);
  assert.equal(a.requiresRestart, true); // crossfade changed

  // An invalid skin is dropped, and the save still succeeds.
  const b = await settings.update({ ui: { skin: '-nope' } });
  assert.equal(b.saved.ui.skin, 'classic');
});

test('update() applies scrobble sub-blocks without clobbering the sibling', async () => {
  await settings.update({
    scrobble: { lastfm: { apiKey: 'k1', apiSecret: 's1', username: 'bob' } },
  });
  // routes/scrobble.ts posts a PARTIAL sub-block after the handshake; a replace
  // would blank apiKey/apiSecret.
  const r = await settings.update({ scrobble: { lastfm: { sessionKey: 'sk', enabled: true } } });
  assert.equal(r.saved.scrobble.lastfm.apiKey, 'k1');
  assert.equal(r.saved.scrobble.lastfm.apiSecret, 's1');
  assert.equal(r.saved.scrobble.lastfm.username, 'bob');
  assert.equal(r.saved.scrobble.lastfm.sessionKey, 'sk');
});

test("update() honours the 'set' redaction sentinel on secrets only", async () => {
  await settings.update({ scrobble: { lastfm: { apiKey: 'real-key', username: 'bob' } } });
  const r = await settings.update({ scrobble: { lastfm: { apiKey: 'set', username: 'set' } } });
  // The secret is kept; a USERNAME of literally 'set' is stored, as it always was.
  assert.equal(r.saved.scrobble.lastfm.apiKey, 'real-key');
  assert.equal(r.saved.scrobble.lastfm.username, 'set');

  await settings.update({ search: { apiKey: 'real-search-key' } });
  const s = await settings.update({ search: { apiKey: 'set' } });
  assert.equal(s.saved.search.apiKey, 'real-search-key');
});

test('update() reports the second slice through fieldErrors at the route', () => {
  const failure = validateSettingsPatch({ stream: { bufferSeconds: 999 }, likes: { maxTracks: 0 } });
  assert.ok(failure);
  assert.deepEqual(Object.keys(failure.fieldErrors).sort(), [
    'likes.maxTracks',
    'stream.bufferSeconds',
  ]);
  // stream's branch runs before likes', so it owns the flat string.
  assert.equal(failure.error, 'stream.bufferSeconds must be a number between 0 and 60');
});
