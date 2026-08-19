// Integration pins for the operator's manual era override (#1418) — the
// precedence rules that decide whose answer survives.
//
// The automatic pipeline has two writers: the library WALK (album tag →
// 'album-tag') and the MusicBrainz phase (→ 'musicbrainz'). The override adds a
// third, 'manual', which must outrank both. That is not a preference, it is a
// correctness requirement: every walk re-visits every track, so an override the
// walk can clobber would be silently undone by the next rescan — the operator
// would fix a record, and the station would forget by morning.
//
// Real better-sqlite3 against a temp STATE_DIR, because all three writers are
// SQL CASE expressions. A pure test over the intent would pass on every
// possible bug here.
//
// Run: npm test -- manual-original-year

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const stateDir = mkdtempSync(join(tmpdir(), 'subwave-manual-era-'));
process.env.STATE_DIR = stateDir;

const db = await import('../src/music/library-db.js');
const { needsOriginalYearLookup } = await import('../src/music/musicbrainz.js');
const { resolveEraYear } = await import('../src/music/show-filter.js');
await db.open({ embeddingDim: 768, adoptStoredDim: true });

after(() => {
  db.close?.();
  rmSync(stateDir, { recursive: true, force: true });
});

// One reissue-anthology track, shaped like the report: a 1964 Stax single on a
// 2012 comp that Navidrome does NOT flag as a compilation, so the walk copies
// the album's originalReleaseDate (2012) straight in as the "original" year.
function seedAnthologyTrack(id: string) {
  db.upsertTrackMeta(id, {
    title: 'After Laughter (Comes Tears)',
    artist: 'Wendy Rene',
    album: 'After Laughter Comes Tears',
    year: 2012,
    originalYear: 2012,   // the album tag, which is just the reissue again
    isCompilation: false, // Navidrome does not flag these
  });
}

test('the reported defect: the walk records the reissue year as "original"', () => {
  seedAnthologyTrack('t1');
  const t = db.getTrack('t1')!;
  assert.equal(t.originalYear, 2012);
  assert.equal(t.originalYearSource, 'album-tag');
  // And so era filtering places a 1964 recording in the 2010s.
  assert.equal(resolveEraYear(t.year, t.originalYear, t.isCompilation), 2012);
  // With no way in: the MB lookup is gated on a flag this album does not set.
  assert.equal(needsOriginalYearLookup(t), false);
});

test('the override writes the operator answer and stamps the source', () => {
  db.setManualOriginalYear('t1', 1964);
  const t = db.getTrack('t1')!;
  assert.equal(t.originalYear, 1964);
  assert.equal(t.originalYearSource, 'manual');
  assert.equal(resolveEraYear(t.year, t.originalYear, t.isCompilation), 1964);
});

test('a later library walk does NOT clobber the override', () => {
  // The load-bearing case. Every walk re-upserts every track with the album
  // tag's year; without the IN ('musicbrainz','manual') guard this write puts
  // 2012 back and the operator's correction lasts until the next rescan.
  seedAnthologyTrack('t1');
  const t = db.getTrack('t1')!;
  assert.equal(t.originalYear, 1964);
  assert.equal(t.originalYearSource, 'manual');
});

test('the MusicBrainz writer does NOT clobber the override either', () => {
  db.setOriginalYear('t1', 1971);
  const t = db.getTrack('t1')!;
  assert.equal(t.originalYear, 1964);
  assert.equal(t.originalYearSource, 'manual');
});

test('an overridden track is not owed a lookup, and is not in the backfill set', () => {
  const t = db.getTrack('t1')!;
  assert.equal(needsOriginalYearLookup(t), false);
  assert.equal(needsOriginalYearLookup(t, true), false, 're-enrich must not re-open a manual answer');
  assert.ok(!db.idsNeedingOriginalYear(true).includes('t1'));
});

test('clearing REMOVES the override rather than pinning "unknown"', () => {
  db.setManualOriginalYear('t1', null);
  const t = db.getTrack('t1')!;
  assert.equal(t.originalYear, null);
  assert.equal(t.originalYearSource, null);
  assert.equal(t.originalYearCheckedAt, null, 'a cleared row must look un-asked, not asked-and-missed');
});

test('after clearing, the automatic pipeline owns the track again', () => {
  // The point of clearing being a REMOVE: "I was wrong about this one" has to
  // be recoverable without a library reset.
  seedAnthologyTrack('t1');
  const t = db.getTrack('t1')!;
  assert.equal(t.originalYear, 2012);
  assert.equal(t.originalYearSource, 'album-tag');
});

test('a genuine compilation still reaches MusicBrainz, and MB still wins over the tag', () => {
  // Guard against fixing #1418 by breaking #842: the existing path is
  // untouched for albums Navidrome DOES flag.
  db.upsertTrackMeta('t2', {
    title: 'Le Freak', artist: 'Chic', album: '100 Hits: 70s Chartbusters',
    year: 2013, originalYear: null, isCompilation: true,
  });
  const before = db.getTrack('t2')!;
  assert.equal(needsOriginalYearLookup(before), true);
  assert.equal(resolveEraYear(before.year, before.originalYear, before.isCompilation), null,
    'an unresolved compilation reads as unknown, not 2013');

  db.setOriginalYear('t2', 1978);
  const after2 = db.getTrack('t2')!;
  assert.equal(after2.originalYear, 1978);
  assert.equal(after2.originalYearSource, 'musicbrainz');

  // ...and the walk cannot undo that either.
  db.upsertTrackMeta('t2', {
    title: 'Le Freak', artist: 'Chic', album: '100 Hits: 70s Chartbusters',
    year: 2013, originalYear: 2013, isCompilation: true,
  });
  assert.equal(db.getTrack('t2')!.originalYear, 1978);
});

test('a manual override outranks an existing MusicBrainz answer', () => {
  // MB reads a recording's first-release-date, which is right far more often
  // than not — but the operator is holding the sleeve.
  db.setManualOriginalYear('t2', 1977);
  const t = db.getTrack('t2')!;
  assert.equal(t.originalYear, 1977);
  assert.equal(t.originalYearSource, 'manual');
});

test('a checked-but-missed row is still reachable by the override', () => {
  // The path an operator actually hits after a re-enrich pass came back empty.
  db.upsertTrackMeta('t3', {
    title: 'Unknown Cut', artist: 'V/A', album: 'Rarities',
    year: 2015, originalYear: null, isCompilation: true,
  });
  db.setOriginalYear('t3', null); // MB asked, found nothing, stamped the miss
  const missed = db.getTrack('t3')!;
  assert.equal(missed.originalYear, null);
  assert.ok(missed.originalYearCheckedAt, 'the miss is stamped so passes skip it');
  assert.equal(needsOriginalYearLookup(missed), false);

  db.setManualOriginalYear('t3', 1969);
  assert.equal(db.getTrack('t3')!.originalYear, 1969);
  assert.equal(db.getTrack('t3')!.originalYearSource, 'manual');
});
