import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const stateDir = mkdtempSync(join(tmpdir(), 'subwave-artist-genres-'));
process.env.STATE_DIR = stateDir;

const db = await import('../src/music/library-db.js');
await db.open({ embeddingDim: 3 });

function tagged(id: string, artist: string, genres: string[]) {
  db.upsertTrackMeta(id, { title: id, artist, album: 'Test', genres });
  db.upsertTrackTags(id, { moods: ['driving'], energy: 'medium', source: 'manual' });
}

test('artist genre profiles aggregate all tagged tracks and omit untagged rows', () => {
  tagged('metal-1', 'Metallica', ['Heavy Metal']);
  tagged('metal-2', 'metallica', ['Thrash Metal', 'Heavy Metal']);
  db.upsertTrackMeta('untagged', { title: 'untagged', artist: 'Metallica', genres: ['Pop'] });

  const profiles = db.artistGenreProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name.toLocaleLowerCase('en'), 'metallica');
  assert.deepEqual(new Set(profiles[0].genres), new Set(['Heavy Metal', 'Thrash Metal']));
});

test.after(() => {
  db.close();
  rmSync(stateDir, { recursive: true, force: true });
});
