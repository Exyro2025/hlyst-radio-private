// Shows moved onto a shared zod schema (controller/src/schemas/show.ts),
// mirrored into web/lib/schemas.generated.ts. These tests pin the PUBLIC
// contract of the three callers that now run it — validateShowsStrict (the
// update() chokepoint), normalizeShows (the lenient load path) and the POST
// /shows route middleware — plus the two places the strict and lenient paths
// are deliberately allowed to differ.
//
// Message WORDING is not asserted except where it carries information the
// operator needs to act (the legacy-field refusal). Accept-vs-reject and the
// returned shape are the contract.
//
// Run: npx tsx scripts/show-schema.test.ts (auto-discovered by npm test).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.STATE_DIR = mkdtempSync(path.join(tmpdir(), 'subwave-show-schema-'));

const { validateShowsStrict } = await import('../src/settings/validate.js');
const { normalizeShows } = await import('../src/settings/normalize.js');
const {
  SHOWS_LIMIT,
  SHOW_FILTER_VALUES_MAX,
  SHOW_NAME_MAX,
  SHOW_TOPIC_MAX,
  legacyShowFieldsIn,
  migrateLegacyShowFields,
  showSchema,
} = await import('../src/schemas/show.js');

const personas = [{ id: 'p_host' }, { id: 'p_guest' }, { id: 'p_third' }];
const personaIds = personas.map((p) => p.id);
const themes = new Set(['classic-light', 'vinyl']);
const moodNames = ['chill', 'upbeat', 'reflective'];

const show = (over: Record<string, unknown> = {}) => ({
  name: 'Breakfast', personaId: 'p_host', ...over,
});
const strict = (over: Record<string, unknown> = {}) =>
  validateShowsStrict([show(over)], personas, themes, moodNames)[0];

const ctx = { personaIds, moodNames, themeIds: [...themes], minTrackSeconds: 40 };

// --- the shape both paths produce -------------------------------------------

test('a minimal show validates and every optional field defaults', () => {
  const s = strict();
  assert.equal(s.name, 'Breakfast');
  assert.equal(s.personaId, 'p_host');
  assert.equal(s.topic, '');
  assert.equal(s.themeId, '');
  assert.equal(s.vocals, '');
  assert.equal(s.maxTrackSeconds, null);
  assert.equal(s.banter, false);
  assert.equal(s.programme, false);
  assert.equal(s.filtersStrict, false);
  assert.deepEqual(s.moods, []);
  assert.deepEqual(s.genres, []);
  assert.deepEqual(s.eras, []);
  assert.deepEqual(s.energies, []);
  assert.deepEqual(s.guestPersonaIds, []);
  assert.match(s.id, /^s_[a-z0-9]+$/);
});

test('name and brief are trimmed, and their limits enforced', () => {
  assert.equal(strict({ name: '  Breakfast  ' }).name, 'Breakfast');
  assert.throws(() => strict({ name: '   ' }), /name/);
  assert.throws(() => strict({ name: 'x'.repeat(SHOW_NAME_MAX + 1) }), /name/);
  assert.throws(() => strict({ topic: 'x'.repeat(SHOW_TOPIC_MAX + 1) }), /topic/);
});

test('the host must exist, and a guest may be neither the host nor a stranger', () => {
  assert.throws(() => strict({ personaId: 'p_nope' }), /personaId/);
  assert.deepEqual(strict({ guestPersonaIds: ['p_guest'] }).guestPersonaIds, ['p_guest']);
  assert.throws(() => strict({ guestPersonaIds: ['p_nope'] }), /guestPersonaIds/);
  assert.throws(() => strict({ guestPersonaIds: ['p_host'] }), /guestPersonaIds/);
});

test('list filters de-duplicate; genres do so case-insensitively', () => {
  assert.deepEqual(strict({ moods: ['chill', 'chill', 'upbeat'] }).moods, ['chill', 'upbeat']);
  assert.deepEqual(strict({ genres: ['Funk', 'funk', 'Soul'] }).genres, ['Funk', 'Soul']);
  assert.deepEqual(strict({ energies: ['low', 'low'] }).energies, ['low']);
});

test('moods must come from the live vocabulary', () => {
  assert.deepEqual(strict({ moods: ['chill'] }).moods, ['chill']);
  assert.throws(() => strict({ moods: ['not-a-mood'] }), /moods/);
});

test('era windows: open ends allowed, empty dropped, backwards rejected', () => {
  assert.deepEqual(strict({ eras: [{ fromYear: 1990, toYear: null }] }).eras,
    [{ fromYear: 1990, toYear: null }]);
  assert.deepEqual(strict({ eras: [{ fromYear: null, toYear: null }] }).eras, []);
  assert.deepEqual(
    strict({ eras: [{ fromYear: 1990, toYear: 1999 }, { fromYear: 1990, toYear: 1999 }] }).eras,
    [{ fromYear: 1990, toYear: 1999 }],
  );
  assert.throws(() => strict({ eras: [{ fromYear: 2000, toYear: 1990 }] }), /eras/);
  assert.throws(() => strict({ eras: [{ fromYear: 1800, toYear: null }] }), /eras/);
});

test('an unknown themeId is dropped to "", a known one preserved', () => {
  // The #917 tolerance: throwing here bricked every shows/schedule save for any
  // install still carrying one retired palette id.
  assert.equal(strict({ themeId: 'vinyl' }).themeId, 'vinyl');
  assert.equal(strict({ themeId: 'sunset' }).themeId, '');
});

test('maxTrackSeconds honours the crossfade-derived floor, and 0 always passes', () => {
  // minTrackSeconds() here comes from the station default crossfade.
  assert.equal(strict({ maxTrackSeconds: 0 }).maxTrackSeconds, 0);
  assert.equal(strict({ maxTrackSeconds: 600 }).maxTrackSeconds, 600);
  assert.equal(strict({ maxTrackSeconds: '' }).maxTrackSeconds, null);
  assert.throws(() => strict({ maxTrackSeconds: 5 }), /maxTrackSeconds/);
  assert.throws(() => strict({ maxTrackSeconds: 1_000_000 }), /maxTrackSeconds/);
});

test('booleans read as `=== true`, matching both paths before the schema', () => {
  // Deliberately NOT z.boolean(): load and save have always agreed to treat a
  // non-boolean as off, and tightening only one of them would split them.
  assert.equal(strict({ banter: true }).banter, true);
  assert.equal(strict({ banter: 'yes' }).banter, false);
  assert.equal(strict({ programme: 1 }).programme, false);
});

test('the array cap is enforced', () => {
  const many = Array.from({ length: SHOWS_LIMIT + 1 }, (_, i) => show({ name: `S${i}` }));
  assert.throws(() => validateShowsStrict(many, personas, themes, moodNames), /shows/);
});

test('a malformed id is re-minted, not rejected', () => {
  // Unlike webhooks. A show id is what the weekly schedule grid points at, so
  // refusing one would turn a single bad id in a backup into a failed restore.
  const s = strict({ id: 'NOT VALID' });
  assert.match(s.id, /^s_[a-z0-9]+$/);
  // A well-formed id survives untouched — grid slots keep pointing at it.
  assert.equal(strict({ id: 's_abc123' }).id, 's_abc123');
});

test('duplicate ids across rows are re-minted', () => {
  const out = validateShowsStrict(
    [show({ id: 's_dupe01' }), show({ id: 's_dupe01' })], personas, themes, moodNames,
  );
  assert.equal(out[0].id, 's_dupe01');
  assert.notEqual(out[1].id, 's_dupe01');
});

// --- legacy singular fields: refused by strict, migrated by lenient ---------

test('legacyShowFieldsIn reports only the keys actually carrying a value', () => {
  assert.deepEqual(legacyShowFieldsIn({ mood: 'chill' }), ['mood']);
  assert.deepEqual(legacyShowFieldsIn({ mood: '', genre: null }), []);
  assert.deepEqual(legacyShowFieldsIn({ moods: ['chill'] }), []);
  assert.deepEqual(legacyShowFieldsIn(null), []);
});

test('the strict path REFUSES a legacy singular field', () => {
  for (const legacy of [
    { mood: 'chill' },
    { genre: 'funk' },
    { energy: 'low' },
    { fromYear: 1990 },
    { maxTrackMinutes: 10 },
  ]) {
    assert.throws(() => strict(legacy), /legacy field/, JSON.stringify(legacy));
  }
});

test('the refusal names the field and says what to do instead', () => {
  // A backup restore is the one caller that meets these, and it answers with
  // `{ error: err.message }` — so the message IS the recovery instructions.
  let msg = '';
  try {
    strict({ mood: 'chill' });
  } catch (e) {
    msg = (e as Error).message;
  }
  assert.match(msg, /mood/);
  assert.match(msg, /moods/);
  assert.ok(!msg.includes('\n'), `expected one line, got:\n${msg}`);
});

test('the refusal lives in the SCHEMA, so every caller gets it', () => {
  // Regression: the check first lived in validateShowsStrict, which meant
  // POST /shows — whose middleware parses showPostSchema directly — never ran
  // it. z.object had already stripped the unknown `mood` key, so the route
  // accepted the show, dropped the mood and answered 200. Silent loss on the
  // exact path an operator uses by hand.
  const r = showSchema(ctx).safeParse(show({ mood: 'chill' }));
  assert.equal(r.success, false);
  assert.match(r.error!.issues[0].message, /legacy field/);
});

test('the lenient path MIGRATES the same fields', () => {
  const [s] = normalizeShows([{
    name: 'Old', personaId: 'p_host',
    mood: 'chill', genre: 'funk, soul', energy: 'low',
    fromYear: 1990, toYear: 1999, maxTrackMinutes: 10,
  }], personaIds);
  assert.deepEqual(s.moods, ['chill']);
  // The comma-crammed legacy genre field splits into individually-resolvable tags.
  assert.deepEqual(s.genres, ['funk', 'soul']);
  assert.deepEqual(s.energies, ['low']);
  assert.deepEqual(s.eras, [{ fromYear: 1990, toYear: 1999 }]);
  assert.equal(s.maxTrackSeconds, 600);
});

test('migrateLegacyShowFields leaves an already-plural show alone', () => {
  const out = migrateLegacyShowFields({ name: 'X', moods: ['chill'], mood: 'upbeat' });
  assert.deepEqual(out.moods, ['chill']);
  assert.equal('mood' in out, false);
});

// --- the lenient path's own leniency ----------------------------------------

test('load never throws, whatever settings.json holds', () => {
  for (const raw of [null, 'nope', 42, {}, [null], ['x'], [{}], [{ name: 7 }]]) {
    assert.doesNotThrow(() => normalizeShows(raw as unknown, personaIds));
  }
});

test('load drops a show with no identity or no owner', () => {
  assert.deepEqual(normalizeShows([{ personaId: 'p_host' }], personaIds), []);
  assert.deepEqual(normalizeShows([{ name: 'X', personaId: 'p_gone' }], personaIds), []);
});

test('load repairs what a working show can survive; strict rejects the same input', () => {
  const cases: Array<[Record<string, unknown>, (s: Record<string, any>) => void]> = [
    [{ name: 'x'.repeat(SHOW_NAME_MAX + 20) }, (s) => assert.equal(s.name.length, SHOW_NAME_MAX)],
    [{ vocals: 'nonsense' }, (s) => assert.equal(s.vocals, '')],
    [{ energies: ['low', 'bogus'] }, (s) => assert.deepEqual(s.energies, ['low'])],
    [{ maxTrackSeconds: 9_999_999 }, (s) => assert.ok(s.maxTrackSeconds <= 36000)],
    [{ eras: [{ fromYear: 2000, toYear: 1990 }] }, (s) => assert.deepEqual(s.eras, [])],
    [{ guestPersonaIds: ['p_host', 'p_gone', 'p_guest'] },
      (s) => assert.deepEqual(s.guestPersonaIds, ['p_guest'])],
  ];
  for (const [over, check] of cases) {
    const [s] = normalizeShows([show(over)], personaIds);
    assert.ok(s, `row dropped instead of repaired: ${JSON.stringify(over)}`);
    check(s as Record<string, any>);
    assert.throws(() => strict(over), JSON.stringify(over));
  }
});

test('load keeps an unknown mood; the strict path rejects it', () => {
  // Deliberate divergence, expressed as CONTEXT (moodNames: null) rather than a
  // second implementation: load runs before the mood cache exists and moods are
  // operator-editable, so filtering against the seed defaults would strip the
  // operator's own. A stale mood just matches nothing on air.
  const [s] = normalizeShows([show({ moods: ['operator-custom'] })], personaIds);
  assert.deepEqual(s.moods, ['operator-custom']);
  assert.throws(() => strict({ moods: ['operator-custom'] }), /moods/);
});

test('load keeps an unknown themeId; the strict path drops it', () => {
  const [s] = normalizeShows([show({ themeId: 'sunset' })], personaIds);
  assert.equal(s.themeId, 'sunset');
  assert.equal(strict({ themeId: 'sunset' }).themeId, '');
});

test('load caps the list at SHOWS_LIMIT', () => {
  const many = Array.from({ length: SHOWS_LIMIT + 9 }, (_, i) => show({ name: `S${i}` }));
  assert.equal(normalizeShows(many, personaIds).length, SHOWS_LIMIT);
});

test('load and save agree on which ids are valid', () => {
  // The id is what the weekly schedule grid points at, so a stored id the load
  // path keeps must be one the next save also keeps — otherwise the show
  // silently changes identity and empties its slots.
  const [kept] = normalizeShows([show({ id: 's_abc123' })], personaIds);
  assert.equal(kept.id, 's_abc123');
  assert.equal(strict({ id: 's_abc123' }).id, 's_abc123');
});

// --- the context nulls -------------------------------------------------------

test('a null context field means "unchecked", not "reject everything"', () => {
  const unchecked = showSchema({
    personaIds, moodNames: null, themeIds: null, minTrackSeconds: null,
  });
  const r = unchecked.safeParse(show({
    moods: ['whatever'], themeId: 'long-gone', maxTrackSeconds: 5,
  }));
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues));
  assert.deepEqual(r.data!.moods, ['whatever']);
  assert.equal(r.data!.themeId, 'long-gone');
  assert.equal(r.data!.maxTrackSeconds, 5);
});

test('personaIds is never optional — both paths always check the host', () => {
  const s = showSchema({ personaIds: [], moodNames: null, themeIds: null, minTrackSeconds: null });
  assert.equal(s.safeParse(show()).success, false);
});

test('the same over-cap input fails on both paths, one by throwing and one by capping', () => {
  const tooMany = { genres: Array.from({ length: SHOW_FILTER_VALUES_MAX + 1 }, (_, i) => `G${i}`) };
  assert.throws(() => strict(tooMany), /genres/);
  const [s] = normalizeShows([show(tooMany)], personaIds);
  assert.equal(s.genres.length, SHOW_FILTER_VALUES_MAX);
});

// --- the error payload the route middleware emits ---------------------------

test('a field error is keyed by the schema field name', () => {
  const r = showSchema(ctx).safeParse(show({ personaId: 'p_nope' }));
  assert.equal(r.success, false);
  assert.deepEqual(r.error!.issues[0].path, ['personaId']);
});

test('a nested field error keeps its full path', () => {
  const r = showSchema(ctx).safeParse(show({ eras: [{ fromYear: 1234567, toYear: null }] }));
  assert.equal(r.success, false);
  // 'eras.0.fromYear' is what flattenIssues emits and what react-hook-form's
  // setError expects.
  assert.deepEqual(r.error!.issues[0].path.slice(0, 2), ['eras', 0]);
});
