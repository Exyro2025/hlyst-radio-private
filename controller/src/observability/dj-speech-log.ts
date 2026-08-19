// Operator-only, human-readable record of DJ speech that reached the air path.
// Unlike events-*.jsonl this is deliberately a compact transcript: one block
// per segment, suitable for tailing or simple line-oriented tooling.

import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { STATE_DIR } from '../config.js';

export const DJ_SPEECH_LOG_MAX_AGE_DAYS = 14;
const LOGS_DIR = `${STATE_DIR}/logs`;

export type DjSpeechLogEntry = {
  airedAt: number;
  speaker: string;
  show: string;
  kind: string;
  text: string;
  track?: { artist?: string | null; title?: string | null } | null;
};

function dayFor(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function timestampFor(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function trackLabel(track: DjSpeechLogEntry['track']): string | null {
  const artist = String(track?.artist || '').trim();
  const title = String(track?.title || '').trim();
  if (!artist && !title) return null;
  return artist && title ? `${artist} — ${title}` : artist || title;
}

export function formatDjSpeech(entry: DjSpeechLogEntry): string {
  const lines = [
    `${timestampFor(entry.airedAt)} | ${entry.speaker || 'DJ'} | ${entry.show || 'Auto DJ'}`,
    `TYPE: ${entry.kind || 'announcement'}`,
  ];
  const track = trackLabel(entry.track);
  if (track) lines.push(`TRACK: ${track}`);
  lines.push('', entry.text.trim(), '', '');
  return lines.join('\n');
}

// Best-effort: transcript writes must never interfere with an on-air segment.
export function logDjSpeech(entry: DjSpeechLogEntry): void {
  const path = `${LOGS_DIR}/dj-speech-${dayFor(entry.airedAt)}.log`;
  mkdir(LOGS_DIR, { recursive: true })
    .then(() => appendFile(path, formatDjSpeech(entry)))
    .catch(() => {});
}

// Matches the event-log horizon. Daily files rotate naturally because each new
// write chooses its date's file; scheduler cleanup removes old day files.
export async function pruneOldDjSpeechLogs(
  maxAgeDays = DJ_SPEECH_LOG_MAX_AGE_DAYS,
  logsDir = LOGS_DIR,
): Promise<number> {
  const cutoff = dayFor(Date.now() - maxAgeDays * 86_400_000);
  let names: string[];
  try {
    names = await readdir(logsDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const match = name.match(/^dj-speech-(\d{4}-\d{2}-\d{2})\.log$/);
    if (!match || match[1] >= cutoff) continue;
    try {
      await unlink(`${logsDir}/${name}`);
      removed += 1;
    } catch {}
  }
  return removed;
}
