import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { formatDjSpeech, pruneOldDjSpeechLogs } from '../src/observability/dj-speech-log.js';

test('formats a parseable DJ speech transcript block', () => {
  assert.equal(formatDjSpeech({
    airedAt: new Date(2026, 7, 18, 13, 31, 13).getTime(),
    speaker: 'Chris Sittins',
    show: 'Another Day, Another Spin',
    kind: 'link',
    track: { artist: 'New York Dolls', title: 'Personality Crisis' },
    text: 'The New York Dolls with their raw, proto-punk energy.',
  }), [
    '2026-08-18 13:31:13 | Chris Sittins | Another Day, Another Spin',
    'TYPE: link',
    'TRACK: New York Dolls — Personality Crisis',
    '',
    'The New York Dolls with their raw, proto-punk energy.',
    '',
    '',
  ].join('\n'));
});

test('keeps the 14-day horizon and ignores unrelated log files', async () => {
  const logs = await mkdtemp(join(tmpdir(), 'subwave-dj-speech-log-'));
  const today = new Date().toISOString().slice(0, 10);
  const old = new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10);
  await writeFile(join(logs, `dj-speech-${old}.log`), 'old');
  await writeFile(join(logs, `dj-speech-${today}.log`), 'new');
  await writeFile(join(logs, `events-${old}.jsonl`), 'unrelated');

  assert.equal(await pruneOldDjSpeechLogs(14, logs), 1);
  assert.deepEqual((await readdir(logs)).sort(), [`dj-speech-${today}.log`, `events-${old}.jsonl`].sort());
});
