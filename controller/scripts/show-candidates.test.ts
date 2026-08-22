import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShowCandidateDiagnostic } from '../src/music/show-candidates.js';

const rows = [
  { id: 'jazz-calm', title: 'One', artist: 'A', genre: 'Jazz', year: 1994, moods: ['calm'], audioMoods: [], energy: 'low' },
  { id: 'jazz-loud', title: 'Two', artist: 'B', genre: 'Jazz', year: 1994, moods: ['calm'], audioMoods: [], energy: 'high' },
  { id: 'rock-calm', title: 'Three', artist: 'C', genre: 'Rock', year: 1994, moods: ['calm'], audioMoods: [], energy: 'low' },
];
const locks = { genres: ['Jazz'], eras: [], moods: ['calm'], energies: ['low'], vocals: null };

test('candidate funnel shows the strict playlist intersection and exclusions', () => {
  const result = buildShowCandidateDiagnostic({
    show: { filtersStrict: true, genres: ['Jazz'], playlistStrict: true },
    libraryRows: rows,
    playlistRows: [rows[0]!, rows[1]!],
    excludedIds: new Set(['jazz-calm']),
    locks,
  });
  assert.equal(result.strict, true);
  assert.deepEqual(result.library, { indexed: 3, matchingFilters: 1, afterExclusions: 0, effective: 0 });
  assert.deepEqual(result.playlist, { total: 2, matchingFilters: 1, afterExclusions: 0, effective: 0 });
});

test('soft filters remain advisory while the filter-fit count stays visible', () => {
  const result = buildShowCandidateDiagnostic({
    show: { filtersStrict: false, genres: ['Jazz'], playlistStrict: false },
    libraryRows: rows,
    playlistRows: [rows[0]!, rows[1]!],
    excludedIds: new Set(['rock-calm']),
    locks,
  });
  assert.equal(result.library.matchingFilters, 1);
  assert.equal(result.library.effective, 2);
  assert.equal(result.playlist?.effective, 2);
});
