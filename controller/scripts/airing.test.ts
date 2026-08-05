// Tests for the airing-memory policy (music/airing.ts) and the plays-table
// queries behind it (library-db/plays.ts lastAiredIndex/deepCutTracks).
//
// Pins the exploration half of the repeated-songs fix: the plays table records
// every airing durably, but no picking path ever read it, so a track unaired
// for two years and one aired yesterday had identical draw probability in
// every sampled source. The freshness signal must be a soft ranking BIAS
// (random-dominant, never a hard filter), and deep cuts must surface tracks
// that never aired or fell out of rotation.
//
// Runs a REAL better-sqlite3 DB against a temp STATE_DIR, so STATE_DIR is set
// before library-db is imported (dynamic import below), matching
// scripts/stem-backfill.test.ts.
// Run: `tsx scripts/airing.test.ts` (folded into `npm run test`).

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => { failures++; console.error(`  ✗ ${name}\n      ${err?.message || err}`); });
}

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const stateDir = mkdtempSync(join(tmpdir(), 'subwave-airing-'));
  process.env.STATE_DIR = stateDir;

  const airing = await import('../src/music/airing.js');
  const db = await import('../src/music/library-db.js');
  const now = Date.now();

  console.log('freshness ramp:');

  await test('never aired is fully fresh; just aired is fully stale', () => {
    assert.equal(airing.freshness(null, now), 1);
    assert.equal(airing.freshness(undefined, now), 1);
    assert.equal(airing.freshness(now, now), 0);
    // Clock skew: a play stamped in the future never yields a negative.
    assert.equal(airing.freshness(now + DAY, now), 0);
  });

  await test('the ramp is linear to the horizon, then saturates', () => {
    const half = airing.freshness(now - (airing.AIRING_FRESH_DAYS / 2) * DAY, now);
    assert.ok(Math.abs(half - 0.5) < 1e-9, `expected 0.5 at half-horizon, got ${half}`);
    assert.equal(airing.freshness(now - airing.AIRING_FRESH_DAYS * DAY, now), 1);
    assert.equal(airing.freshness(now - 10 * airing.AIRING_FRESH_DAYS * DAY, now), 1);
  });

  console.log('\nlastAiredMsOf:');

  await test('id hit wins; title|artist key catches duplicate copies; miss is null', () => {
    const index = {
      byId: new Map([['id-1', now - DAY]]),
      byKey: new Map([['song|artist', now - 2 * DAY]]),
    };
    assert.equal(airing.lastAiredMsOf({ id: 'id-1', title: 'Other', artist: 'X' }, index), now - DAY);
    // A different Subsonic id for the same tagged song resolves via the key.
    assert.equal(airing.lastAiredMsOf({ id: 'id-2', title: 'Song', artist: 'Artist' }, index), now - 2 * DAY);
    assert.equal(airing.lastAiredMsOf({ id: 'id-3', title: 'Unheard', artist: 'Y' }, index), null);
  });

  console.log('\nfreshness-biased order:');

  await test('unaired tracks win the cap more often, but never deterministically', () => {
    const index = { byId: new Map([['aired', now]]), byKey: new Map<string, number>() };
    const list = [
      { id: 'aired', title: 'A', artist: 'a' },
      { id: 'unheard', title: 'B', artist: 'b' },
    ];
    let unheardFirst = 0;
    let airedFirst = 0;
    for (let i = 0; i < 2000; i++) {
      const first = airing.freshnessBiasedOrder(list, index, now)[0];
      if (first.id === 'unheard') unheardFirst++;
      else airedFirst++;
    }
    // Analytically P(unheard first) = 1 - (1 - w)^2 / 2 ≈ 0.82 at w = 0.4.
    assert.ok(unheardFirst / 2000 > 0.65, `bias too weak: ${unheardFirst}/2000`);
    assert.ok(airedFirst > 0, 'bias must stay soft — the aired track must still sometimes lead');
  });

  await test('with no play history the order is a plain shuffle', () => {
    const list = [
      { id: 'x', title: 'X', artist: 'x' },
      { id: 'y', title: 'Y', artist: 'y' },
    ];
    let xFirst = 0;
    for (let i = 0; i < 2000; i++) {
      if (airing.freshnessBiasedOrder(list, airing.EMPTY_AIRED_INDEX, now)[0].id === 'x') xFirst++;
    }
    assert.ok(xFirst / 2000 > 0.4 && xFirst / 2000 < 0.6, `not uniform: ${xFirst}/2000`);
  });

  console.log('\nplays-table queries (real DB):');

  await db.open({ embeddingDim: 768, adoptStoredDim: true });
  for (const id of ['t1', 't2', 't3']) {
    db.upsertTrackMeta(id, { title: `Song ${id}`, artist: 'A', album: 'B', duration: 200 });
  }
  const iso = (ms: number) => new Date(ms).toISOString();
  // t1 aired twice (yesterday wins), t2 aired long ago, t3 never; plus an
  // id-less backfilled play that must land in the key index only.
  db.recordPlay({ trackId: 't1', title: 'Song t1', artist: 'A', album: 'B', playedAt: iso(now - 40 * DAY), source: 'ai', requestedBy: null, showId: null, showName: null });
  db.recordPlay({ trackId: 't1', title: 'Song t1', artist: 'A', album: 'B', playedAt: iso(now - DAY), source: 'ai', requestedBy: null, showId: null, showName: null });
  db.recordPlay({ trackId: 't2', title: 'Song t2', artist: 'A', album: 'B', playedAt: iso(now - 60 * DAY), source: 'auto', requestedBy: null, showId: null, showName: null });
  db.recordPlay({ trackId: null, title: 'Ghost Play', artist: 'Nobody', album: null, playedAt: iso(now - 2 * DAY), source: 'auto', requestedBy: null, showId: null, showName: null });

  await test('lastAiredIndex keeps the NEWEST airing per id and per key', () => {
    const idx = db.lastAiredIndex();
    assert.equal(idx.byId.get('t1'), Date.parse(iso(now - DAY)));
    assert.equal(idx.byId.get('t2'), Date.parse(iso(now - 60 * DAY)));
    assert.equal(idx.byId.get('t3'), undefined);
    assert.equal(idx.byKey.get('song t1|a'), Date.parse(iso(now - DAY)));
    assert.equal(idx.byKey.get('ghost play|nobody'), Date.parse(iso(now - 2 * DAY)));
  });

  await test('deepCutTracks returns never-aired + long-unaired, not the recent airing', () => {
    const cutoff = iso(now - airing.DEEP_CUT_DAYS * DAY);
    const ids = db.deepCutTracks(cutoff, 10).map((t) => t.id).sort();
    // t1 aired yesterday (in rotation); t2's last airing predates the cutoff;
    // t3 never aired at all.
    assert.deepEqual(ids, ['t2', 't3']);
  });

  await test('deepCutTracks honours its limit', () => {
    const cutoff = iso(now + DAY); // everything qualifies
    assert.equal(db.deepCutTracks(cutoff, 2).length, 2);
  });

  if (failures) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\nall tests passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
