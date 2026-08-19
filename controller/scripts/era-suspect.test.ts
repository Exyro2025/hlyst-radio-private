// Unit pins for the anthology detector behind #1418 — the judgement that
// replaces "Navidrome set isCompilation" as the trigger for an original-year
// lookup and for treating an album's year as untrustworthy.
//
// The tuning here is PRECISION-first and the tests are written to hold that
// line: the negative cases (an ordinary album that must NOT be flagged) are the
// ones that matter, because a false positive costs a MusicBrainz request and
// can drop a perfectly good album out of era-bounded shows.
//
// Run: npm test -- era-suspect

import test from 'node:test';
import assert from 'node:assert/strict';
import { albumEraSuspect, titleYearRange } from '../src/music/era-suspect.js';

// ── titleYearRange ───────────────────────────────────────────────────────────

test('reads a full four-digit range', () => {
  assert.deepEqual(titleYearRange('The Atco/Atlantic Singles 1968-1974'), { from: 1968, to: 1974 });
});

test('expands a two-digit close against the open year', () => {
  assert.deepEqual(
    titleYearRange('Complete Stax & Volt Singles + Rarities 1964–65'),
    { from: 1964, to: 1965 },
  );
});

test('rolls a two-digit close over a century boundary', () => {
  assert.deepEqual(titleYearRange('Sessions 1998-02'), { from: 1998, to: 2002 });
});

test('accepts en dash and em dash as well as hyphen', () => {
  assert.deepEqual(titleYearRange('Anthology 1970—1979'), { from: 1970, to: 1979 });
});

test('a BARE year is not a range', () => {
  // "Woodstock 1969" and "Top 40 Hits of 2015" must not read as anthologies —
  // a lone 4-digit number in a title is more often a name than a date.
  assert.equal(titleYearRange('Woodstock 1969'), null);
  assert.equal(titleYearRange('Top 40 Hits of 2015'), null);
});

test('rejects a backwards or implausible range', () => {
  assert.equal(titleYearRange('Nonsense 1974-1968'), null);
  assert.equal(titleYearRange('Catalogue 0001-0002'), null);
});

test('does not match inside a longer digit run', () => {
  assert.equal(titleYearRange('Serial 12345-6789'), null);
});

// ── albumEraSuspect: the markers ─────────────────────────────────────────────

test("Navidrome's compilation flag still fires first", () => {
  assert.deepEqual(
    albumEraSuspect({ isCompilation: true, albumArtist: 'Chic', title: '100 Hits', year: 2013 }),
    { suspect: true, reason: 'compilation-flag' },
  );
});

test('a Various Artists album artist is enough on its own', () => {
  for (const name of ['Various Artists', 'various', 'VA', 'Various  Artists']) {
    assert.equal(albumEraSuspect({ albumArtist: name, year: 2012 }).suspect, true, name);
  }
});

test('three or more distinct credited artists is an anthology', () => {
  assert.deepEqual(
    albumEraSuspect({ albumArtist: 'Various', distinctTrackArtists: 12, year: 2012, isCompilation: false }),
    { suspect: true, reason: 'various-artists' },
  );
  assert.equal(albumEraSuspect({ albumArtist: 'Stax', distinctTrackArtists: 3, year: 2012 }).reason, 'many-artists');
});

test('TWO credited artists is NOT enough', () => {
  // The precision line. A duo record, a split, a collaboration album and any
  // features-heavy rap record all credit two — flagging them would fire
  // constantly and mean nothing.
  assert.equal(albumEraSuspect({ albumArtist: 'Simon & Garfunkel', distinctTrackArtists: 2, year: 1970 }).suspect, false);
});

test('the reported single-artist anthology is caught by its title range', () => {
  // Allen Toussaint, The Atco/Atlantic Singles 1968-1974 (2015 reissue) —
  // ONE credited artist throughout, so every artist-count signal misses it.
  assert.deepEqual(
    albumEraSuspect({
      isCompilation: false,
      albumArtist: 'Allen Toussaint',
      title: 'The Atco/Atlantic Singles 1968-1974',
      year: 2015,
      distinctTrackArtists: 1,
    }),
    { suspect: true, reason: 'title-year-range' },
  );
});

test('the other reported anthology is caught too', () => {
  assert.equal(
    albumEraSuspect({
      isCompilation: false,
      albumArtist: 'Various Artists',
      title: 'After Laughter Comes Tears: Complete Stax & Volt Singles + Rarities 1964–65',
      year: 2012,
      distinctTrackArtists: 8,
    }).suspect,
    true,
  );
});

// ── albumEraSuspect: what must stay clear ────────────────────────────────────

test('an ordinary single-artist album is not suspect', () => {
  assert.deepEqual(
    albumEraSuspect({
      isCompilation: false, albumArtist: 'Radiohead', title: 'In Rainbows',
      year: 2007, distinctTrackArtists: 1,
    }),
    { suspect: false, reason: null },
  );
});

test('a range that CLOSES in the album year is describing when it was made', () => {
  // "Sessions 2014-2015" on a 2015 album is not an anthology.
  assert.equal(
    albumEraSuspect({ albumArtist: 'A Band', title: 'Sessions 2014-2015', year: 2015, distinctTrackArtists: 1 }).suspect,
    false,
  );
});

test('a title range with no album year to compare against stays clear', () => {
  // Untagged year — we cannot tell "collects older material" from "made then",
  // and guessing is the expensive direction.
  assert.equal(
    albumEraSuspect({ albumArtist: 'A Band', title: 'Recordings 1968-1974', year: null, distinctTrackArtists: 1 }).suspect,
    false,
  );
});

test('an explicit isCompilation:false does not override a real marker', () => {
  // The whole defect: Navidrome says false on exactly these records, so a
  // false must never be read as "definitely not an anthology".
  assert.equal(
    albumEraSuspect({ isCompilation: false, albumArtist: 'Various Artists', year: 2012 }).suspect,
    true,
  );
});

test('empty / unknown facts are not suspect', () => {
  assert.equal(albumEraSuspect({}).suspect, false);
  assert.equal(albumEraSuspect({ isCompilation: null, albumArtist: null, title: null, year: null }).suspect, false);
});
