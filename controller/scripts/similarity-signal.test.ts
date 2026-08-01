// Unit tests for the musical signal that goes into the embed text (#1246).
// Run: `tsx scripts/similarity-signal.test.ts` (folded into `npm test`).
//
// All pure, and it fails SILENTLY in production if it regresses: a dropped
// Sound line just means similarity quietly goes back to ranking artist names,
// and a changed text shape with no version bump means new vectors drift from
// old ones inside the same KNN space. Nothing throws, so the asserts here are
// the only alarm.
//
// The issue's SECOND finding (artistKey ignoring featured credits) is not
// here: #1251 / PR #1261 fixes it with a separate `artistRootKey`, keeping
// artistKey as the identity key that trackKey depends on.
// node:assert-via-tsx style, matching scripts/lastfm-enrich.test.ts.

import assert from 'node:assert/strict';
import {
  EMBED_TEXT_VERSION,
  formatTrackText,
  resolveIndexTextFormat,
  soundDescriptors,
} from '../src/music/embeddings.js';

let failures = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => { failures++; console.error(`  ✗ ${name}\n      ${err?.message || err}`); });
}

async function main() {
  console.log('soundDescriptors (measured signal, never the tagger\'s own moods):');

  await test('audio moods lead, then tempo, then mode', () => {
    // Stable order matters: the same input must always produce the same vector.
    assert.deepEqual(
      soundDescriptors({ audioMoods: ['dreamy', 'melancholic'], bpm: 92, musicalKey: '8A' }),
      ['dreamy', 'melancholic', 'mid-tempo', 'minor key'],
    );
  });

  await test('tempo bands', () => {
    assert.deepEqual(soundDescriptors({ bpm: 62 }), ['slow tempo']);
    assert.deepEqual(soundDescriptors({ bpm: 92 }), ['mid-tempo']);
    assert.deepEqual(soundDescriptors({ bpm: 124 }), ['upbeat tempo']);
    assert.deepEqual(soundDescriptors({ bpm: 174 }), ['fast tempo']);
  });

  await test('an unknown bpm is never described as slow', () => {
    // ID3 writes bpm 0 for "not set"; treating it as a tempo would cluster every
    // untagged track as "slow".
    assert.deepEqual(soundDescriptors({ bpm: 0 }), []);
    assert.deepEqual(soundDescriptors({ bpm: -1 }), []);
    assert.deepEqual(soundDescriptors({ bpm: null }), []);
    assert.deepEqual(soundDescriptors({ bpm: Number.NaN }), []);
  });

  await test('Camelot codes become a mode, never a raw token', () => {
    // "8A" embeds as an arbitrary token; "minor key" is the musically legible
    // half. The tonic NUMBER is deliberately dropped.
    assert.deepEqual(soundDescriptors({ musicalKey: '8A' }), ['minor key']);
    assert.deepEqual(soundDescriptors({ musicalKey: '11B' }), ['major key']);
    assert.deepEqual(soundDescriptors({ musicalKey: '8a' }), ['minor key']);
    // Anything that isn't a Camelot code contributes nothing rather than noise.
    assert.deepEqual(soundDescriptors({ musicalKey: 'A minor' }), []);
    assert.deepEqual(soundDescriptors({ musicalKey: '' }), []);
  });

  await test('nothing analysed yields no words at all', () => {
    assert.deepEqual(soundDescriptors(null), []);
    assert.deepEqual(soundDescriptors({}), []);
    assert.deepEqual(soundDescriptors({ audioMoods: [] }), []);
  });

  console.log('formatTrackText (the canonical embed text):');

  const song = { title: 'Parasite', artist: 'Nick Drake', album: 'Pink Moon', year: 2013, genres: ['Folk'] };

  await test('un-enriched, un-analysed text is unchanged from v1', () => {
    // The whole install base is embedded at this shape — it must stay
    // byte-identical or every existing vector silently mismatches new ones.
    assert.equal(
      formatTrackText(song),
      'Nick Drake — Parasite · Pink Moon (2013) [Folk]',
    );
    assert.equal(formatTrackText(song, null, null), formatTrackText(song));
    // An acoustics object with nothing IN it must also change nothing — the
    // common case while analysis is still backfilling.
    assert.equal(formatTrackText(song, null, { bpm: null }), formatTrackText(song));
  });

  await test('measured sound is appended as its own line', () => {
    const text = formatTrackText(song, null, { audioMoods: ['wistful'], bpm: 88, musicalKey: '8A' });
    assert.match(text, /\nSound: wistful, mid-tempo, minor key$/);
    // and the head line is untouched
    assert.match(text, /^Nick Drake — Parasite/);
  });

  await test('the Sound line sits after the enrichment lines', () => {
    const text = formatTrackText(
      song,
      { lastfmTags: ['folk', 'acoustic'], lyricExcerpt: 'take a look at you now' },
      { bpm: 88 },
    );
    const lines = text.split('\n');
    assert.equal(lines.length, 4);
    assert.match(lines[1], /^Last\.fm:/);
    assert.match(lines[2], /^Lyrics:/);
    assert.match(lines[3], /^Sound:/);
  });

  await test('the formatter is deterministic — same input, same string', () => {
    const a = { audioMoods: ['dreamy', 'warm'], bpm: 92, musicalKey: '8A' };
    assert.equal(formatTrackText(song, null, a), formatTrackText(song, null, { ...a }));
  });

  console.log('resolveIndexTextFormat (what shape the stored index actually is):');

  await test('an empty index adopts the current format', () => {
    // A fresh install is entirely v2, so it must never show the advisory.
    assert.equal(resolveIndexTextFormat(null, 0), EMBED_TEXT_VERSION);
    assert.equal(resolveIndexTextFormat(1, 0), EMBED_TEXT_VERSION);
  });

  await test('a populated index keeps its older format — the advisory must persist', () => {
    // A forward run only embeds tracks with no vector, so the index becomes a
    // MIX. Recording the current version would erase the one signal that a
    // re-embed is worth running.
    assert.equal(resolveIndexTextFormat(1, 20_000), 1);
    assert.equal(resolveIndexTextFormat(null, 20_000), 1);
  });

  await test('a reseed adopts the current format — it rebuilt every vector', () => {
    assert.equal(resolveIndexTextFormat(1, 20_000, true), EMBED_TEXT_VERSION);
  });

  await test('a format from the future is never written backwards', () => {
    // Downgrading the controller must not stamp a newer index as older.
    assert.equal(resolveIndexTextFormat(99, 20_000), EMBED_TEXT_VERSION);
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\nall similarity-signal tests passed');
}

main();
