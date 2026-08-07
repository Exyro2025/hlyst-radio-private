// Playlists moved onto a shared zod schema (controller/src/schemas/playlist.ts),
// mirrored into web/lib/schemas.generated.ts. Playlists have NO settings.update()
// chokepoint, so the strict/lenient split lives inside the schema module itself:
// the knobs never throw, the request wrappers do. These tests pin that line, the
// shared intent predicate, and the recipe-store repair.
//
// Run: npx tsx scripts/playlist-schema.test.ts (auto-discovered by npm test).
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  PLAYLIST_NAME_MAX,
  normalizeRecipeRow,
  playlistAppendSchema,
  playlistGenerateSchema,
  playlistHasIntent,
  playlistPatchSchema,
  playlistRecipeSchema,
  playlistRemoveTracksSchema,
  playlistSaveSchema,
} = await import('../src/schemas/playlist.js');

// --- the four refusals: the operator's input being wrong ---------------------

test('save requires a name, and caps it visibly', () => {
  assert.equal(playlistSaveSchema.safeParse({}).success, false);
  assert.equal(playlistSaveSchema.safeParse({ name: '   ' }).success, false);
  assert.equal(
    playlistSaveSchema.safeParse({ name: 'x'.repeat(PLAYLIST_NAME_MAX + 1) }).success,
    false,
  );
  const r = playlistSaveSchema.parse({ name: '  Late Drive  ' });
  assert.equal(r.name, 'Late Drive');
});

test('append requires at least one id AFTER filtering', () => {
  assert.equal(playlistAppendSchema.safeParse({}).success, false);
  assert.equal(playlistAppendSchema.safeParse({ songIds: [] }).success, false);
  // Non-string entries are dropped, and a list of only-droppables is empty.
  assert.equal(playlistAppendSchema.safeParse({ songIds: [42, '  '] }).success, false);
  assert.deepEqual(playlistAppendSchema.parse({ songIds: [' a ', 'b'] }).songIds, ['a', 'b']);
});

test('a patch that changes nothing rejects; an empty rename rejects', () => {
  assert.equal(playlistPatchSchema.safeParse({}).success, false);
  assert.equal(playlistPatchSchema.safeParse({ name: '  ' }).success, false);
  assert.equal(playlistPatchSchema.parse({ name: ' New ' }).name, 'New');
  assert.equal(playlistPatchSchema.parse({ public: false }).public, false);
});

test('remove-tracks requires at least one valid index', () => {
  assert.equal(playlistRemoveTracksSchema.safeParse({}).success, false);
  assert.equal(playlistRemoveTracksSchema.safeParse({ indexes: [-1, 1.5] }).success, false);
  assert.deepEqual(playlistRemoveTracksSchema.parse({ indexes: [0, 3, -1] }).indexes, [0, 3]);
});

test('generate with nothing to generate from rejects', () => {
  assert.equal(playlistGenerateSchema.safeParse({}).success, false);
  assert.equal(playlistGenerateSchema.safeParse({ knobs: { targetCount: 30 } }).success, false);
  assert.equal(playlistGenerateSchema.safeParse({ prompt: 'rainy night drive' }).success, true);
});

// --- the knobs never throw ---------------------------------------------------

test('garbage knobs are a preference the engine ignores, never a 400', () => {
  // The same shape is run by the recipe-store read, where a throw wedges sync
  // on boot — and the engine has always clamped targetCount and ignored a
  // garbage mood, so failing a body over one would be a regression.
  const r = playlistGenerateSchema.safeParse({
    prompt: 'ok',
    knobs: { targetCount: 'many', moods: 'not-an-array', bogus: true },
    sources: 'nope',
  });
  assert.equal(r.success, true);
  assert.deepEqual(r.data!.sources, {});
  assert.equal((r.data!.knobs as Record<string, unknown>).bogus, true);
});

test('targetCount gets NO schema default', () => {
  // playlist-gen reads `targetCount ?? (targetMinutes ? … : DEFAULT)`, so a
  // default here would silently retire targetMinutes.
  const r = playlistRecipeSchema.parse({ knobs: {} });
  assert.equal('targetCount' in r.knobs, false);
});

test('songIds is deliberately uncapped', () => {
  // The deck can hold a playlist LOADED from Navidrome; refusing to re-save
  // what the server already holds would be a new failure.
  const ids = Array.from({ length: 2000 }, (_, i) => `t${i}`);
  assert.equal(playlistSaveSchema.parse({ name: 'big', songIds: ids }).songIds.length, 2000);
});

// --- the shared intent rule --------------------------------------------------

test('playlistHasIntent unifies the two copies that had diverged', () => {
  // The route counted `knobs.eras?.length`, so an era window with both ends
  // open was intent server-side and not client-side. The unified rule: a
  // window counts only when it carries at least one real bound.
  assert.equal(playlistHasIntent({ knobs: { eras: [{ fromYear: null, toYear: null }] } }), false);
  assert.equal(playlistHasIntent({ knobs: { eras: [{ fromYear: 1990, toYear: null }] } }), true);
  assert.equal(playlistHasIntent({}), false);
  assert.equal(playlistHasIntent({ prompt: '   ' }), false);
  assert.equal(playlistHasIntent({ prompt: 'x' }), true);
  assert.equal(playlistHasIntent({ seedTrackIds: ['a'] }), true);
  assert.equal(playlistHasIntent({ seedArtist: 'Nick Drake' }), true);
  assert.equal(playlistHasIntent({ sources: { recentlyAdded: true } }), true);
  assert.equal(playlistHasIntent({ knobs: { moods: ['calm'] } }), true);
  assert.equal(playlistHasIntent({ knobs: { minBpm: 120 } }), true);
  assert.equal(playlistHasIntent({ knobs: { instrumentalOnly: true } }), true);
});

// --- the recipe-store repair -------------------------------------------------

test('a row missing its recipe is REPAIRED, not kept broken or dropped', () => {
  // The old read kept any row with a string playlistId and nothing else, so a
  // hand-edited entry missing `recipe` reached syncRecipe and threw on
  // `entry.recipe.prompt` — "Sync now" answered 500.
  const row = normalizeRecipeRow({ playlistId: 'pl-1' });
  assert.ok(row);
  assert.deepEqual(row!.recipe.knobs, {});
  assert.deepEqual(row!.recipe.sources, {});
  assert.equal(row!.perSyncCap, 25);
  assert.equal(row!.lastSyncedAt, null);
  assert.equal(row!.lastResult, null);
});

test('a row with no identity is the only drop', () => {
  assert.equal(normalizeRecipeRow(null), null);
  assert.equal(normalizeRecipeRow({}), null);
  assert.equal(normalizeRecipeRow({ playlistId: '   ' }), null);
});

test('a healthy row round-trips untouched', () => {
  const row = normalizeRecipeRow({
    playlistId: 'pl-2',
    name: 'Late Drive',
    recipe: { prompt: 'rainy', seedTrackIds: ['a'], knobs: { moods: ['calm'] }, sources: {} },
    perSyncCap: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSyncedAt: '2026-02-01T00:00:00.000Z',
    lastResult: { added: 3, at: '2026-02-01T00:00:00.000Z' },
  });
  assert.ok(row);
  assert.equal(row!.name, 'Late Drive');
  assert.equal(row!.recipe.prompt, 'rainy');
  assert.deepEqual(row!.recipe.seedTrackIds, ['a']);
  assert.equal(row!.perSyncCap, 10);
  assert.deepEqual(row!.lastResult, { added: 3, at: '2026-02-01T00:00:00.000Z' });
});
