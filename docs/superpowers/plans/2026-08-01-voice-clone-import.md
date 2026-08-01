# Voice Clone Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator upload, audition, and delete voice-clone reference clips from `/admin/imaging?tab=voices`, instead of FTP-ing WAVs into `state/voices/` by hand.

**Architecture:** A new `controller/src/audio/voice-library.ts` becomes the single scanner of the voice folders, split into a cheap `scan()` (readdir + stat, what `/settings` polls) and a probing `list()` (adds duration, memoised on size+mtime). `chatterbox.listReferenceVoices()` is refactored to delegate to `scan()` so there is exactly one scanner. A new `routes/voices.ts` exposes list / upload / delete / audition, all admin-gated, with `:file` params resolved through `scan()` rather than interpolated into a path. The web side adds a fourth tab to the existing Imaging page, mirroring `SfxSection`.

**Tech Stack:** Node 20 ESM + TypeScript (controller), Express + multer, ffmpeg/ffprobe (already in every Docker image), Next.js 15 App Router + Tailwind (web), `tsx` subprocess tests via `controller/scripts/run-tests.ts`.

**Spec:** `docs/superpowers/specs/2026-08-01-voice-clone-import-design.md`

## Global Constraints

- **Lint is the merge gate.** `npm run lint` (`eslint . && tsc --noEmit`) must pass in both `controller/` and `web/`. CI runs it; a merge is blocked on it.
- **Tests are not in CI** — run `npm test` in `controller/` yourself before pushing. Dropping a `*.test.ts` file into `controller/scripts/` is the whole registration step; no package.json edit.
- **Inline styles are eslint-forbidden in `web/`.** Express everything as Tailwind classes.
- **No `Math.random()` in web components** (lint trap). Not needed here.
- **PR target is `develop`, never `main`.**
- **No "Generated with Claude Code" attribution** in commits or the PR body.
- **`chatterbox.listReferenceVoices()` keeps its exact signature** — `Promise<string[]>` of `.wav` filenames. The root `CLAUDE.md` names it the single listing path and `GET /settings` calls it on every admin poll (every 3s). It must never call the probing `list()`.
- **Advisory duration band:** `ADVISORY_MIN_SEC = 4`, `ADVISORY_MAX_SEC = 20`. Length is advisory only — it never blocks or truncates an import.
- **Canonical stored form:** mono, 24 kHz, `pcm_s16le` WAV. The `.wav` extension is load-bearing (`scan()` filters on it; the cloning workers need real WAV bytes).

---

### Task 1: `voice-library` module

The folder owner: scan, list with durations, import, delete, resolve-by-name. Includes the `transcodeAudio` option knobs its import path needs.

**Files:**
- Create: `controller/src/audio/voice-library.ts`
- Modify: `controller/src/audio/audio-import.ts` (add `sampleRate` / `channels` to `transcodeAudio`)
- Test: `controller/scripts/voice-library.test.ts`

**Interfaces:**
- Consumes: `config.voices.{dir,legacyDir}` from `../config.js`; `slugify` from `../util/slug.js`; `transcodeAudio`, `hasFfmpeg`, `extOf`, `baseName`, `isAcceptedAudio`, `probeDurationSec` from `./audio-import.js`.
- Produces, for Tasks 2 and 3:
  - `ADVISORY_MIN_SEC: number`, `ADVISORY_MAX_SEC: number`
  - `type VoiceWarning = 'short' | 'long' | null`
  - `voiceWarning(durationSec: number | null | undefined): VoiceWarning`
  - `voiceFileName(name: string): string` — throws on an empty slug
  - `type VoiceFile = { file: string; dir: string; path: string; legacy: boolean; size: number; mtimeMs: number }`
  - `type VoiceEntry = { file: string; size: number; legacy: boolean; durationSec: number | null; warning: VoiceWarning }`
  - `scan(): Promise<VoiceFile[]>`
  - `list(): Promise<VoiceEntry[]>`
  - `resolve(file: string): Promise<VoiceFile | null>`
  - `importVoice(buffer: Buffer, opts: { name: string; originalName?: string }): Promise<VoiceEntry>`
  - `removeVoice(file: string): Promise<{ ok: true; file: string }>`
  - `durationMemoKey(entry: VoiceFile): string`

- [ ] **Step 1: Write the failing test**

Create `controller/scripts/voice-library.test.ts`:

```ts
// Pins controller/src/audio/voice-library.ts — the single owner of the shared
// voice-clone folder (state/voices/ + the legacy state/chatterbox-voices/).
//
// Three properties are load-bearing and easy to regress:
//
//  - `resolve()` NEVER builds a path from caller input. It basenames, then
//    looks the name up in the real scan. Both the delete and the audition
//    route pass an operator-supplied :file straight into it, so a traversal
//    here is a filesystem read primitive behind the admin gate.
//  - Canonical dir wins over legacy on a filename clash, and a clash is a
//    refused import — silently clobbering a voice would swap it out from
//    under every persona pointing at that filename.
//  - The duration memo invalidates on size AND mtime. A stale duration on a
//    replaced file would show the wrong advisory forever.
//
// STATE_DIR is redirected at a throwaway dir BEFORE the first import so
// config.ts derives its voice dirs there — hence the dynamic import. Same
// style as scripts/voice-policy.test.ts.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'subwave-voicelib-'));
process.env.STATE_DIR = root;
// These would move the canonical dir out from under the test.
delete process.env.TTS_VOICE_DIR;
delete process.env.CHATTERBOX_VOICE_DIR;
// Task 2 imports chatterbox.ts, which starts a 30s /health probe loop at module
// load when this is set — that would hold the test process open forever.
delete process.env.TTS_HEAVY_URL;

const VOICES = join(root, 'voices');
const LEGACY = join(root, 'chatterbox-voices');
mkdirSync(VOICES, { recursive: true });
mkdirSync(LEGACY, { recursive: true });

const lib = await import('../src/audio/voice-library.js');

let failures = 0;
function check(label: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ok  ${label}`))
    .catch((err) => { failures++; console.error(`  FAIL ${label}: ${err.message}`); });
}

// --- voiceWarning: the advisory band, pure ---------------------------------
await check('voiceWarning flags a clip under the floor', () => {
  assert.equal(lib.voiceWarning(2), 'short');
  assert.equal(lib.voiceWarning(lib.ADVISORY_MIN_SEC - 0.1), 'short');
});
await check('voiceWarning flags a clip over the ceiling', () => {
  assert.equal(lib.voiceWarning(45), 'long');
  assert.equal(lib.voiceWarning(lib.ADVISORY_MAX_SEC + 0.1), 'long');
});
await check('voiceWarning is silent inside the band and at its edges', () => {
  assert.equal(lib.voiceWarning(10), null);
  assert.equal(lib.voiceWarning(lib.ADVISORY_MIN_SEC), null);
  assert.equal(lib.voiceWarning(lib.ADVISORY_MAX_SEC), null);
});
await check('voiceWarning treats an unknown duration as no advice, not as bad', () => {
  // No ffprobe on a bare-host dev box — unknown must not render a warning.
  assert.equal(lib.voiceWarning(null), null);
  assert.equal(lib.voiceWarning(undefined), null);
  assert.equal(lib.voiceWarning(NaN), null);
});

// --- voiceFileName: slug + forced .wav -------------------------------------
await check('voiceFileName slugifies and forces .wav', () => {
  assert.equal(lib.voiceFileName('Morgan Freeman'), 'morgan-freeman.wav');
  assert.equal(lib.voiceFileName('  Late Night DJ  '), 'late-night-dj.wav');
});
await check('voiceFileName strips an audio extension the operator typed', () => {
  // The import modal defaults the name from the filename stem, but an operator
  // typing "morgan.wav" must not get "morgan-wav.wav".
  assert.equal(lib.voiceFileName('morgan.wav'), 'morgan.wav');
  assert.equal(lib.voiceFileName('Morgan.MP3'), 'morgan.wav');
});
await check('voiceFileName rejects a name with no slug left', () => {
  assert.throws(() => lib.voiceFileName('   '), /name is required/i);
  assert.throws(() => lib.voiceFileName('!!!'), /name is required/i);
});

// --- scan: merge, dedupe, filter, sort -------------------------------------
writeFileSync(join(VOICES, 'alpha.wav'), 'a');
writeFileSync(join(VOICES, 'shared.wav'), 'canonical');
writeFileSync(join(LEGACY, 'shared.wav'), 'legacy-loses');
writeFileSync(join(LEGACY, 'zulu.wav'), 'z');
writeFileSync(join(VOICES, 'notes.txt'), 'not audio');

await check('scan lists .wav from both dirs, sorted, non-wav excluded', async () => {
  const files = (await lib.scan()).map(e => e.file);
  assert.deepEqual(files, ['alpha.wav', 'shared.wav', 'zulu.wav']);
});
await check('scan dedupes a clash with the canonical dir winning', async () => {
  const shared = (await lib.scan()).find(e => e.file === 'shared.wav');
  assert.equal(shared?.legacy, false);
  assert.equal(shared?.dir, VOICES);
});
await check('scan flags a legacy-only file as legacy', async () => {
  const zulu = (await lib.scan()).find(e => e.file === 'zulu.wav');
  assert.equal(zulu?.legacy, true);
  assert.equal(zulu?.path, join(LEGACY, 'zulu.wav'));
});

// --- resolve: the traversal gate -------------------------------------------
await check('resolve returns the entry for a listed file', async () => {
  const e = await lib.resolve('alpha.wav');
  assert.equal(e?.path, join(VOICES, 'alpha.wav'));
});
await check('resolve refuses traversal and absolute paths', async () => {
  for (const bad of ['../alpha.wav', '../../etc/passwd', '/etc/passwd', 'sub/alpha.wav', '..']) {
    assert.equal(await lib.resolve(bad), null, `resolve(${bad}) must be null`);
  }
});
await check('resolve refuses an unlisted or non-wav name', async () => {
  assert.equal(await lib.resolve('nope.wav'), null);
  assert.equal(await lib.resolve('notes.txt'), null);
  assert.equal(await lib.resolve(''), null);
});

// --- duration memo key: invalidates on size AND mtime ----------------------
await check('durationMemoKey changes when size or mtime changes', () => {
  const base = { file: 'a.wav', dir: VOICES, path: join(VOICES, 'a.wav'), legacy: false, size: 10, mtimeMs: 100 };
  const same = lib.durationMemoKey({ ...base });
  assert.equal(lib.durationMemoKey(base), same, 'identical entry must reuse the memo');
  assert.notEqual(lib.durationMemoKey({ ...base, size: 11 }), same, 'a resized file must re-probe');
  assert.notEqual(lib.durationMemoKey({ ...base, mtimeMs: 101 }), same, 'a rewritten file must re-probe');
});

// --- importVoice: the guards that run before any ffmpeg work ---------------
await check('importVoice refuses a name that already exists in either dir', async () => {
  await assert.rejects(
    lib.importVoice(Buffer.from('x'), { name: 'alpha', originalName: 'alpha.wav' }),
    /already exists/i,
  );
  // zulu.wav lives only in the legacy dir — still a clash.
  await assert.rejects(
    lib.importVoice(Buffer.from('x'), { name: 'zulu', originalName: 'zulu.wav' }),
    /already exists/i,
  );
});
await check('importVoice refuses a non-audio upload', async () => {
  await assert.rejects(
    lib.importVoice(Buffer.from('x'), { name: 'notes', originalName: 'notes.txt' }),
    /unsupported audio type/i,
  );
});
await check('importVoice refuses an empty buffer', async () => {
  await assert.rejects(
    lib.importVoice(Buffer.alloc(0), { name: 'empty', originalName: 'empty.wav' }),
    /empty/i,
  );
});

// --- removeVoice -----------------------------------------------------------
await check('removeVoice deletes a legacy-dir file too', async () => {
  await lib.removeVoice('zulu.wav');
  assert.equal(await lib.resolve('zulu.wav'), null);
});
await check('removeVoice refuses an unknown name', async () => {
  await assert.rejects(lib.removeVoice('ghost.wav'), /unknown voice/i);
});

rmSync(root, { recursive: true, force: true });
if (failures) {
  console.error(`\nvoice-library: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nvoice-library: all checks passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd controller && npm test -- voice-library`
Expected: FAIL — the module doesn't exist yet, so the dynamic import throws
`Cannot find module '../src/audio/voice-library.js'`.

- [ ] **Step 3: Add the sample-rate / channel knobs to `transcodeAudio`**

In `controller/src/audio/audio-import.ts`, widen the options and emit the flags.
Replace the signature and the codec block:

```ts
// Transcode an in-memory upload to outPath in the given format. The input is
// written to a temp file (not piped) so seek-dependent containers like m4a/mp4
// decode correctly. `loudnorm` applies EBU R128 levelling — appropriate for
// speech-length jingles, left off for short transient effects where a one-pass
// loudnorm on <2s of audio is unreliable. `sampleRate`/`channels` pin the
// output format — voice-clone references are stored mono 24 kHz so every
// cloning worker gets the same canonical shape.
export async function transcodeAudio(
  input: Buffer,
  { outPath, format, loudnorm = false, atempo, sampleRate, channels }: {
    outPath: string;
    format: TranscodeFormat;
    loudnorm?: boolean;
    atempo?: number;
    sampleRate?: number;
    channels?: number;
  },
): Promise<void> {
```

and inside, after the existing codec selection, before `args.push('-y', outPath)`:

```ts
    if (format === 'wav') args.push('-c:a', 'pcm_s16le');
    else args.push('-c:a', 'libmp3lame', '-q:a', '4');
    if (sampleRate) args.push('-ar', String(sampleRate));
    if (channels) args.push('-ac', String(channels));
    args.push('-y', outPath);
```

- [ ] **Step 4: Write the `voice-library` module**

Create `controller/src/audio/voice-library.ts`:

```ts
// The shared voice-clone reference folder — state/voices/ plus the legacy
// pre-#213 state/chatterbox-voices/. Chatterbox and PocketTTS both clone from
// the WAVs in here (a persona's `tts.voice` is one of these filenames), and
// custom Piper .onnx voices live alongside them.
//
// This module is the SINGLE scanner of those directories: chatterbox.ts's
// listReferenceVoices() delegates to scan(), and the admin /voices routes use
// list()/importVoice()/removeVoice()/resolve(). Two entry points on purpose —
// GET /settings calls the listing path on every 3s admin poll, so scan() stays
// readdir+stat and never spawns a subprocess; only list() probes durations.
//
// Deliberately NO JSON sidecar (unlike broadcast/sfx.ts). This folder is
// documented as operator-writable by hand and dropping files in over FTP keeps
// working — a sidecar would carry no entry for those files and go stale the
// moment someone used the old route. Durations are memoised on size+mtime
// instead, which covers hand-dropped files too.

import { readdir, stat, unlink, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { slugify } from '../util/slug.js';
import {
  transcodeAudio, hasFfmpeg, extOf, baseName, isAcceptedAudio, probeDurationSec,
} from './audio-import.js';

// Advisory band for a reference clip. Under the floor there may not be enough
// signal for a stable clone; over the ceiling every render gets slower without
// sounding better. Advisory ONLY — nothing here truncates or refuses on length.
export const ADVISORY_MIN_SEC = 4;
export const ADVISORY_MAX_SEC = 20;

// Canonical stored form. Both cloning workers resample internally, so mono
// 24 kHz is a safe common denominator that also keeps the files small.
const TARGET_SAMPLE_RATE = 24_000;
const TARGET_CHANNELS = 1;

export type VoiceWarning = 'short' | 'long' | null;

export type VoiceFile = {
  file: string;
  dir: string;
  path: string;
  legacy: boolean;
  size: number;
  mtimeMs: number;
};

export type VoiceEntry = {
  file: string;
  size: number;
  legacy: boolean;
  durationSec: number | null;
  warning: VoiceWarning;
};

// Pure. An unknown duration (no ffprobe on a bare-host dev box) is "no advice",
// never "bad" — the UI must not scold an operator over a missing tool.
export function voiceWarning(durationSec: number | null | undefined): VoiceWarning {
  if (durationSec == null || !Number.isFinite(durationSec)) return null;
  if (durationSec < ADVISORY_MIN_SEC) return 'short';
  if (durationSec > ADVISORY_MAX_SEC) return 'long';
  return null;
}

// The on-disk filename for an operator-supplied name. Always `.wav` — scan()
// filters on that extension and the workers need real WAV bytes. An audio
// extension the operator typed is stripped first so "morgan.wav" doesn't
// become "morgan-wav.wav" via slugify's dot handling.
export function voiceFileName(name: string): string {
  const raw = String(name || '').trim();
  const stem = isAcceptedAudio(raw) ? baseName(raw) : raw;
  const slug = slugify(stem);
  if (!slug) throw new Error('Voice name is required');
  return `${slug}.wav`;
}

async function scanDir(dir: string, legacy: boolean): Promise<VoiceFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return []; // Not created yet — the pre-install state, not an error.
  }
  const out: VoiceFile[] = [];
  for (const file of entries) {
    if (!file.toLowerCase().endsWith('.wav')) continue;
    const p = path.join(dir, file);
    try {
      const s = await stat(p);
      if (!s.isFile()) continue;
      out.push({ file, dir, path: p, legacy, size: s.size, mtimeMs: s.mtimeMs });
    } catch {
      // Raced with a delete between readdir and stat — just skip it.
    }
  }
  return out;
}

// readdir + stat only. This is what GET /settings hits on every admin poll —
// keep it subprocess-free. Canonical dir wins on a filename clash, matching
// chatterbox.resolveReferenceWav()'s resolution order.
export async function scan(): Promise<VoiceFile[]> {
  const [primary, legacy] = await Promise.all([
    scanDir(config.voices.dir, false),
    scanDir(config.voices.legacyDir, true),
  ]);
  const seen = new Set<string>();
  const merged: VoiceFile[] = [];
  for (const e of [...primary, ...legacy]) {
    if (seen.has(e.file)) continue;
    seen.add(e.file);
    merged.push(e);
  }
  return merged.sort((a, b) => a.file.localeCompare(b.file));
}

// Memo key for a probed duration. Size AND mtime, so replacing a file in place
// (re-upload, or a hand-copy over FTP) re-probes rather than showing a stale
// length forever.
export function durationMemoKey(entry: VoiceFile): string {
  return `${entry.path}:${entry.size}:${entry.mtimeMs}`;
}

const durationMemo = new Map<string, number | null>();
// Bounded so a long-lived controller re-uploading the same names can't grow it
// without limit. The folder is a handful of files; a full clear is cheap.
const MEMO_MAX = 200;

async function durationOf(entry: VoiceFile): Promise<number | null> {
  const key = durationMemoKey(entry);
  const hit = durationMemo.get(key);
  if (hit !== undefined) return hit;
  const measured = await probeDurationSec(entry.path);
  if (durationMemo.size >= MEMO_MAX) durationMemo.clear();
  durationMemo.set(key, measured);
  return measured;
}

// scan() plus measured durations. Admin-facing only — never call this from the
// /settings listing path.
export async function list(): Promise<VoiceEntry[]> {
  const files = await scan();
  const out: VoiceEntry[] = [];
  for (const e of files) {
    const durationSec = await durationOf(e);
    out.push({
      file: e.file,
      size: e.size,
      legacy: e.legacy,
      durationSec,
      warning: voiceWarning(durationSec),
    });
  }
  return out;
}

// Look up a caller-supplied filename. NEVER builds a path from the input: it
// basenames, rejects anything that changed under basename (a separator or a
// traversal segment), then requires the name to be present in the real scan.
// Both admin :file routes go through here.
export async function resolve(file: string): Promise<VoiceFile | null> {
  const raw = String(file || '');
  if (!raw) return null;
  if (path.basename(raw) !== raw) return null;
  const files = await scan();
  return files.find(e => e.file === raw) || null;
}

// Import an operator-supplied clip as a reference voice. Transcoded to the
// canonical mono 24 kHz WAV — which also validates the upload, since ffmpeg
// exits non-zero on anything that isn't decodable audio.
//
// Note the divergence from sfx.importAudio's no-ffmpeg fallback: storing raw
// bytes under the original extension is NOT safe here, because the .wav
// extension is load-bearing twice over (scan() filters on it; the workers need
// real WAV bytes). Without ffmpeg we take a .wav through untouched and refuse
// anything else with a message naming the missing tool. Every Docker image
// ships ffmpeg, so this only bites `npm start` on a bare host.
export async function importVoice(
  buffer: Buffer,
  { name, originalName = '' }: { name: string; originalName?: string },
): Promise<VoiceEntry> {
  const file = voiceFileName(name);
  if (!buffer?.length) throw new Error('Empty audio file');
  if (originalName && !isAcceptedAudio(originalName)) {
    throw new Error(`Unsupported audio type: ${originalName}`);
  }
  // Refuse a clash rather than clobber: the filename IS the reference every
  // persona holds, so overwriting would silently swap a persona's voice.
  if (await resolve(file)) {
    throw new Error(`a voice named "${file}" already exists — delete it first`);
  }

  const dir = config.voices.dir;
  await mkdir(dir, { recursive: true });
  const outPath = path.join(dir, file);

  if (await hasFfmpeg()) {
    await transcodeAudio(buffer, {
      outPath,
      format: 'wav',
      sampleRate: TARGET_SAMPLE_RATE,
      channels: TARGET_CHANNELS,
    });
  } else if (extOf(originalName) === 'wav') {
    await writeFile(outPath, buffer);
  } else {
    throw new Error(
      'ffmpeg is not installed on this host, so only .wav uploads can be accepted'
      + ' — convert the file first, or run the Docker image (it ships ffmpeg)',
    );
  }

  // Length is advisory: measure it, report it, never act on it.
  const durationSec = await probeDurationSec(outPath);
  const s = await stat(outPath);
  return {
    file,
    size: s.size,
    legacy: false,
    durationSec,
    warning: voiceWarning(durationSec),
  };
}

// Delete by filename, from whichever dir it actually lives in — so a
// legacy-folder voice is manageable from the UI too.
export async function removeVoice(file: string): Promise<{ ok: true; file: string }> {
  const entry = await resolve(file);
  if (!entry) throw new Error(`unknown voice: ${file}`);
  await unlink(entry.path);
  return { ok: true, file: entry.file };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd controller && npm test -- voice-library`
Expected: PASS — `voice-library: all checks passed`, exit 0.

- [ ] **Step 6: Run lint**

Run: `cd controller && npm run lint`
Expected: clean (`eslint . && tsc --noEmit`).

- [ ] **Step 7: Commit**

```bash
git add controller/src/audio/voice-library.ts controller/src/audio/audio-import.ts controller/scripts/voice-library.test.ts
git commit -m "feat(voices): add the voice-library module owning state/voices/"
```

---

### Task 2: Point `listReferenceVoices()` at the shared scanner

One scanner, not two. `chatterbox.listReferenceVoices()` keeps its signature and its legacy-folder log; only its internals change.

**Files:**
- Modify: `controller/src/audio/chatterbox.ts` (replace `readVoiceWavs` + `listReferenceVoices`, lines ~239–278)
- Test: `controller/scripts/voice-library.test.ts` (extend)

**Interfaces:**
- Consumes: `scan()` from Task 1.
- Produces: `listReferenceVoices(): Promise<string[]>` — unchanged signature, still consumed by `routes/settings/core.ts` as both `tts.chatterboxVoices` and `tts.pocketTtsCustomVoices`.

- [ ] **Step 1: Write the failing test**

Append to `controller/scripts/voice-library.test.ts`, immediately before the
`rmSync(root, …)` teardown line:

```ts
// --- chatterbox.listReferenceVoices delegates to the one scanner -----------
// Signature is load-bearing: routes/settings/core.ts publishes the result as
// both tts.chatterboxVoices and tts.pocketTtsCustomVoices on every 3s poll.
const chatterbox = await import('../src/audio/chatterbox.js');

await check('listReferenceVoices returns the same filenames scan() found', async () => {
  const scanned = (await lib.scan()).map(e => e.file);
  const listed = await chatterbox.listReferenceVoices();
  assert.deepEqual(listed, scanned);
});
await check('listReferenceVoices returns a plain string[] of .wav names', async () => {
  const listed = await chatterbox.listReferenceVoices();
  assert.ok(Array.isArray(listed));
  for (const v of listed) {
    assert.equal(typeof v, 'string', 'must be filenames, not objects');
    assert.match(v, /\.wav$/i);
  }
});
await check('a newly imported voice shows up without a restart', async () => {
  // No ffmpeg needed: a .wav upload is stored through untouched.
  writeFileSync(join(VOICES, 'seed-check.wav'), 'seed');
  assert.ok((await chatterbox.listReferenceVoices()).includes('seed-check.wav'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd controller && npm test -- voice-library`
Expected: the three new checks FAIL. `listReferenceVoices` still runs its own
`readVoiceWavs` scan, so it will not agree with `scan()` — most visibly it
sorts the merged list differently and does not verify `isFile()`.

- [ ] **Step 3: Delegate to the shared scanner**

In `controller/src/audio/chatterbox.ts`, add the import near the other local
imports at the top of the file:

```ts
import { scan as scanVoices } from './voice-library.js';
```

Then replace the whole block from the `// List the reference-WAV filenames …`
comment through the end of `listReferenceVoices()` (the `let legacyWarned`
declaration, `readVoiceWavs`, and `listReferenceVoices`) with:

```ts
// List the reference-WAV filenames the operator has in the shared voice
// directory. The admin UI uses these to populate the per-persona voice dropdown
// for BOTH Chatterbox and PocketTTS (issue #213). Returns [] (not an error) if
// the directories don't exist yet — that's the pre-install state and the UI
// handles it gracefully.
//
// The scan itself lives in audio/voice-library.ts, which is the single owner of
// those directories (the admin import/delete routes use the same scan). This
// stays the documented listing path and keeps its shape — a plain string[] —
// because GET /settings publishes it on every admin poll. Deliberately calls
// scan() and NOT list(): list() probes durations with ffprobe, which would mean
// a subprocess per voice per poll.
let legacyWarned = false;
export async function listReferenceVoices(): Promise<string[]> {
  const files = await scanVoices();
  const legacy = files.filter(f => f.legacy);
  if (legacy.length > 0 && !legacyWarned) {
    legacyWarned = true;
    console.log(
      `[voices] reading ${legacy.length} legacy voice(s) from ${config.voices.legacyDir}`
      + ` — move them to ${config.voices.dir} when convenient`,
    );
  }
  return files.map(f => f.file);
}
```

`readdir` may now be unused in `chatterbox.ts` — if `tsc`/eslint flags it, drop
it from the `node:fs/promises` import line.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd controller && npm test -- voice-library`
Expected: PASS, all checks including the three new ones.

- [ ] **Step 5: Run the full controller suite and lint**

Run: `cd controller && npm test && npm run lint`
Expected: every test file passes; lint clean. (The full suite matters here —
this task changes a function other code paths call.)

- [ ] **Step 6: Commit**

```bash
git add controller/src/audio/chatterbox.ts controller/scripts/voice-library.test.ts
git commit -m "refactor(voices): listReferenceVoices delegates to the shared scanner"
```

---

### Task 3: Admin routes — list, upload, delete, audition

**Files:**
- Create: `controller/src/routes/voices.ts`
- Modify: `controller/src/server.ts` (import + mount, alongside `sfxRoutes`)

**Interfaces:**
- Consumes: everything Task 1 produced; `requireAdmin` from `../middleware/auth.js`; `audioUpload` from `../middleware/upload.js`; `hasFfmpeg` + `audioContentType` from `../audio/audio-import.js`; `queue` from `../broadcast/queue.js`.
- Produces, for Task 4 (the web client):
  - `GET /voices` → `{ voices: VoiceEntry[], dir: string, legacyDir: string, ffmpeg: boolean, advisory: { minSec: number, maxSec: number } }`
  - `POST /voices/upload` — multipart, fields `file` + `name` → `VoiceEntry` (400 on any rejection)
  - `DELETE /voices/:file` → `{ ok: true, file: string }`
  - `GET /voices/:file/audio` → the raw stored clip

- [ ] **Step 1: Write the route file**

Create `controller/src/routes/voices.ts`:

```ts
// Admin-gated voice-clone library management — the reference WAVs Chatterbox
// and PocketTTS clone from (a persona's `tts.voice` is one of these filenames).
//
// Mirrors routes/sfx.ts's import flow, minus the generate half: there is no
// prompt-to-voice generator, only operator-supplied recordings. Dropping files
// into state/voices/ on the host still works and is still listed here — this
// just removes the need to.
import express from 'express';
import * as voices from '../audio/voice-library.js';
import { config } from '../config.js';
import { queue } from '../broadcast/queue.js';
import { requireAdmin } from '../middleware/auth.js';
import { audioUpload } from '../middleware/upload.js';
import { audioContentType, hasFfmpeg } from '../audio/audio-import.js';

export const router = express.Router();

// `dir` rides along so the UI can name the host folder in its hint, and
// `ffmpeg` so it can warn up-front that only .wav will be accepted (a bare-host
// dev box rather than any Docker image).
router.get('/voices', requireAdmin, async (req, res) => {
  try {
    res.json({
      voices: await voices.list(),
      dir: config.voices.dir,
      legacyDir: config.voices.legacyDir,
      ffmpeg: await hasFfmpeg(),
      advisory: { minSec: voices.ADVISORY_MIN_SEC, maxSec: voices.ADVISORY_MAX_SEC },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import an operator-supplied clip (multipart `file`, `name`). Transcoded to
// the canonical mono 24 kHz WAV. Every rejection is a 400 with the module's
// message — they're all operator-fixable (bad type, duplicate name, no ffmpeg).
router.post('/voices/upload', requireAdmin, audioUpload('file'), async (req, res) => {
  const file = req.file;
  const name = (req.body?.name || '').trim();
  if (!file) return res.status(400).json({ error: 'file is required' });
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const created = await voices.importVoice(file.buffer, {
      name,
      originalName: file.originalname,
    });
    queue.log('scheduler', `Voice imported: "${created.file}"`);
    res.json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// No in-use guard by design: a persona pointing at a deleted file keeps the
// value visible with a `missing` hint, and the workers fall back to their
// built-in voice with a logged reason.
router.delete('/voices/:file', requireAdmin, async (req, res) => {
  try {
    res.json(await voices.removeVoice(req.params.file));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Audition the stored clip — hear what was uploaded without a TTS round-trip.
// `:file` is resolved through the library's scan (never interpolated into a
// path), so anything not currently listed is a 404 rather than a filesystem
// read.
router.get('/voices/:file/audio', requireAdmin, async (req, res) => {
  try {
    const entry = await voices.resolve(req.params.file);
    if (!entry) return res.status(404).json({ error: 'unknown voice' });
    res.type(audioContentType(entry.path)).sendFile(entry.path);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Mount the router**

In `controller/src/server.ts`, add the import beside the other route imports
(near `import { router as sfxRoutes } from './routes/sfx.js';`):

```ts
import { router as voiceRoutes } from './routes/voices.js';
```

and mount it beside the others (near `app.use(sfxRoutes);`):

```ts
app.use(voiceRoutes);
```

- [ ] **Step 3: Verify the routes by hand**

Start the dev stack (`subwave-worktree-dev` skill, or an isolated controller via
the `verify` skill), then with `ADMIN_USER`/`ADMIN_PASS` from `.env`:

```bash
# list — expect {"voices":[…],"dir":"…/state/voices","ffmpeg":true,…}
curl -su "$ADMIN_USER:$ADMIN_PASS" http://localhost:7701/voices | head -c 400

# upload an mp3 — expect a VoiceEntry whose file ends .wav
curl -su "$ADMIN_USER:$ADMIN_PASS" -F file=@/path/to/sample.mp3 -F name="Test Voice" \
  http://localhost:7701/voices/upload

# traversal must 404, not read a file
curl -su "$ADMIN_USER:$ADMIN_PASS" -o /dev/null -w '%{http_code}\n' \
  'http://localhost:7701/voices/..%2F..%2Fsettings.json/audio'

# unauthenticated must 401
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:7701/voices
```

Expected: list returns JSON; the mp3 lands as `test-voice.wav`; traversal is
`404`; unauthenticated is `401`.

- [ ] **Step 4: Run tests and lint**

Run: `cd controller && npm test && npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 5: Commit**

```bash
git add controller/src/routes/voices.ts controller/src/server.ts
git commit -m "feat(voices): admin routes to list, import, audition and delete voices"
```

---

### Task 4: The Voices tab on `/admin/imaging`

**Files:**
- Create: `web/components/admin/imaging/VoicesSection.tsx`
- Modify: `web/components/admin/imaging/types.ts` (add `VoiceEntry` / `VoiceData`)
- Modify: `web/components/admin/imaging/ImagingPanel.tsx` (tab id, fetch, handlers, render, confirm dialog, masthead copy)
- Modify: `web/components/admin/AdminShell.tsx` (submenu entry + `Mic` icon import)

**Interfaces:**
- Consumes: the four endpoints from Task 3.
- Produces: no exports other components depend on. `VoicesSection`'s props are
  `{ voicesData: VoiceData | null; busy: boolean; uploadVoice: (file: File, name: string) => Promise<boolean>; onDelete: (file: string | null) => void; adminFetch: (path: string, init?: RequestInit) => Promise<Response> }`.

**Note:** `web/` has no test suite (root `CLAUDE.md`). Verification here is
`npm run lint` plus the manual browser pass in Step 7.

- [ ] **Step 1: Add the types**

Append to `web/components/admin/imaging/types.ts`:

```ts
export interface VoiceEntry {
  file: string;
  size?: number;
  durationSec?: number | null;
  legacy?: boolean;
  warning?: 'short' | 'long' | null;
}

export interface VoiceData {
  voices?: VoiceEntry[];
  dir?: string;
  legacyDir?: string;
  ffmpeg?: boolean;
  advisory?: { minSec: number; maxSec: number };
}
```

- [ ] **Step 2: Write the section component**

Create `web/components/admin/imaging/VoicesSection.tsx`:

```tsx
'use client';

/* The voice-clone reference library — the WAVs Chatterbox and PocketTTS clone
   from. Import-only (there's no prompt-to-voice generator), so this is
   SfxSection's import half without the create half. Dropping files into
   state/voices/ on the host still works and still shows up here. */

import type { ChangeEvent } from 'react';
import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { fmtSize } from '../../../lib/format';
import { Modal } from '../../ui/modal';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { V3Alert } from '../../ui/alert';
import { SkeletonCards } from '@/components/ui/skeleton';
import { Btn } from '../ui';
import { PreviewButton } from '../settings/shared';
import type { VoiceData } from './types';
import {
  SectionMasthead, PanelBox, PanelHead, EmptyState, DropZone, MetaLine, TabMetric, pad2,
} from './parts';

interface VoicesSectionProps {
  voicesData: VoiceData | null;
  busy: boolean;
  uploadVoice: (file: File, name: string) => Promise<boolean>;
  onDelete: (file: string | null) => void;
  adminFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

// Mirrors ACCEPTED_AUDIO_EXTS in controller/src/audio/audio-import.ts.
const ACCEPT = '.wav,.mp3,.ogg,.oga,.flac,.m4a,.aac,.opus,audio/*';

export function VoicesSection({ voicesData, busy, uploadVoice, onDelete, adminFetch }: VoicesSectionProps) {
  // Hooks must run before the early "loading…" return — keep them at the top.
  const [modal, setModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importName, setImportName] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setImportFile(f);
    // Default the name from the filename stem so the common case is one click.
    if (f && !importName.trim()) setImportName(f.name.replace(/\.[^.]+$/, ''));
  };

  const doImport = async () => {
    if (!importFile || !importName.trim()) return;
    const ok = await uploadVoice(importFile, importName);
    if (ok) {
      setImportFile(null);
      setImportName('');
      if (importRef.current) importRef.current.value = '';
      setModal(false);
    }
  };

  if (!voicesData) {
    return <SkeletonCards cards={4} />;
  }
  const list = voicesData.voices || [];
  const dir = voicesData.dir || 'state/voices/';
  const noFfmpeg = voicesData.ffmpeg === false;
  const minSec = voicesData.advisory?.minSec ?? 4;
  const maxSec = voicesData.advisory?.maxSec ?? 20;

  return (
    <section className="grid gap-[22px]">
      <SectionMasthead
        title="Voices"
        sub="Reference clips your DJ personas can be cloned from. About five seconds of clean speech is enough — one voice, no music, no background noise."
        metrics={<TabMetric accent n={pad2(list.length)} l="voices" />}
        actions={
          <Btn sm tone="solid" className="min-h-9 sm:min-h-0" onClick={() => setModal(true)} disabled={busy}>
            Import
          </Btn>
        }
      />

      <PanelBox>
        <PanelHead label={`voice library · ${pad2(list.length)}`} />
        {list.length === 0 ? (
          <EmptyState caption="import a ~5 second recording to clone a voice" />
        ) : (
          <div className="divide-y divide-separator-soft">
            {list.map(v => (
              /* Mobile drops the play/delete cluster under the text — see
                 SfxSection for the same reflow. */
              <div
                key={v.file}
                className="grid grid-cols-1 items-center gap-3 px-[18px] py-[15px] sm:grid-cols-[1fr_auto] sm:gap-[18px]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="font-mono text-[14px] font-bold">{v.file}</span>
                    {v.legacy && <Badge variant="ink">legacy folder</Badge>}
                  </div>
                  <MetaLine>
                    {v.size != null && <span>{fmtSize(v.size)}</span>}
                    {v.durationSec != null && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{v.durationSec}s</span>
                      </>
                    )}
                  </MetaLine>
                  {/* Advisory, never blocking — the operator's file is stored
                      exactly as uploaded. */}
                  {v.warning === 'short' && (
                    <p className="mt-1.5 text-[11px] leading-[1.55] text-muted">
                      Under {minSec}s — there may not be enough speech here to clone reliably.
                    </p>
                  )}
                  {v.warning === 'long' && (
                    <p className="mt-1.5 text-[11px] leading-[1.55] text-muted">
                      Over {maxSec}s — longer clips slow every line this persona speaks without
                      sounding better.
                    </p>
                  )}
                </div>
                <div className="flex flex-none items-center gap-2">
                  <PreviewButton
                    path={`/voices/${encodeURIComponent(v.file)}/audio`}
                    adminFetch={adminFetch}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Delete voice"
                    className="size-9 sm:size-8"
                    disabled={busy}
                    onClick={() => onDelete(v.file)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </PanelBox>

      <Modal
        open={modal}
        onOpenChange={(o) => { if (!o) setModal(false); }}
        title="import voice"
        sub="a short recording of the voice you want to clone"
        footer={
          <>
            <Button variant="ghost" size="sm" className="min-h-9 sm:min-h-0" onClick={() => setModal(false)}>Cancel</Button>
            <Btn
              sm
              tone="accent"
              className="min-h-9 sm:min-h-0"
              onClick={doImport}
              disabled={busy || !importFile || !importName.trim()}
            >
              {busy ? 'Importing…' : 'Import'}
            </Btn>
          </>
        }
      >
        <div className="grid gap-3.5">
          {noFfmpeg && (
            <V3Alert title="wav only on this host">
              ffmpeg isn’t installed here, so other formats can’t be converted. Upload a{' '}
              <code className="font-mono text-[12px]">.wav</code>, or run the Docker image —
              it ships ffmpeg.
            </V3Alert>
          )}
          <div>
            <DropZone
              label={importFile ? importFile.name : 'choose an audio file'}
              hint={noFfmpeg ? 'wav' : 'wav · mp3 · m4a · ogg · flac · opus'}
              onClick={() => importRef.current?.click()}
              disabled={busy}
            />
            <input
              ref={importRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={onPick}
            />
          </div>
          <div>
            <Label htmlFor="voice-import-name">Name</Label>
            <Input
              id="voice-import-name"
              value={importName}
              onChange={e => setImportName(e.target.value)}
              placeholder="late-night-dj"
            />
            <p className="mt-1.5 text-[11px] leading-[1.55] text-muted">
              Becomes the filename personas pick from. Stored as a mono{' '}
              <code className="font-mono text-[12px]">.wav</code> in{' '}
              <code className="font-mono text-[12px]">{dir}</code>, so you can also drop files
              there by hand.
            </p>
          </div>
        </div>
      </Modal>
    </section>
  );
}
```

- [ ] **Step 3: Wire the panel**

In `web/components/admin/imaging/ImagingPanel.tsx`:

Add the import beside the other section imports:

```tsx
import { VoicesSection } from './VoicesSection';
```

Widen the tab union and id list:

```tsx
type TabId = 'jingles' | 'sfx' | 'beds' | 'voices';
const TAB_IDS: TabId[] = ['jingles', 'sfx', 'beds', 'voices'];
```

Add state beside `sfxData` / `bedsData`, and the delete-confirm state beside
`confirmDeleteSfx`:

```tsx
  const [voicesData, setVoicesData] = useState<VoiceData | null>(null);
```
```tsx
  const [confirmDeleteVoice, setConfirmDeleteVoice] = useState<string | null>(null);
```

Extend the type import from `./types` to include `VoiceData`.

Add the refresher beside `refreshSfx` / `refreshBeds`:

```tsx
  const refreshVoices = async () => {
    try {
      const r = await adminFetch('/voices');
      if (!r.ok) return;
      setVoicesData((await r.json()) as VoiceData);
    } catch { /* transient — the 3s poll retries */ }
  };
```

(Match the exact body of the neighbouring `refreshSfx` if it differs.)

Add it to both the initial call and the interval in the existing effect:

```tsx
    refresh(); refreshSfx(); refreshBeds(); refreshVoices();
    const id = setInterval(() => { refresh(); refreshSfx(); refreshBeds(); refreshVoices(); }, 3000);
```

Add the two handlers beside `uploadSfx` / `deleteSfx`:

```tsx
  // Import a voice-clone reference clip. Any accepted audio type — the
  // controller transcodes it to the canonical mono WAV.
  const uploadVoice = async (file: File, name: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', name.trim());
      const r = await adminFetch('/voices/upload', { method: 'POST', body: fd });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || `failed (${r.status})`);
      await refreshVoices();
      notify.ok('voice imported');
      return true;
    } catch (e) { notify.err(`Voice import failed: ${errorMessage(e)}`); return false; }
    finally { setBusy(false); }
  };

  const deleteVoice = async (file: string) => {
    setBusy(true);
    try {
      const r = await adminFetch(`/voices/${encodeURIComponent(file)}`, { method: 'DELETE' });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || `failed (${r.status})`);
      await refreshVoices();
    } catch (e) { notify.err(`Delete failed: ${errorMessage(e)}`); }
    finally { setBusy(false); }
  };
```

Add the tab to the `tabs` array (and `Mic` to the file's `lucide-react` import):

```tsx
    { id: 'voices' as TabId, label: 'Voices', count: voicesData?.voices?.length, icon: Mic },
```

Render it after the `beds` block:

```tsx
        {tab === 'voices' && (
          <VoicesSection
            voicesData={voicesData} busy={busy}
            uploadVoice={uploadVoice}
            onDelete={setConfirmDeleteVoice}
            adminFetch={adminFetch}
          />
        )}
```

And add the confirm dialog after the beds one:

```tsx
      <V3AlertDialog
        open={confirmDeleteVoice != null}
        onOpenChange={(o) => { if (!o) setConfirmDeleteVoice(null); }}
        title="Delete voice"
        description={confirmDeleteVoice ? `Delete the reference voice "${confirmDeleteVoice}"? Any persona still set to it falls back to the engine's built-in voice.` : ''}
        confirmLabel="delete"
        danger
        onConfirm={() => { if (confirmDeleteVoice) deleteVoice(confirmDeleteVoice); setConfirmDeleteVoice(null); }}
      />
```

Finally, extend the masthead blurb so the fourth tab is described alongside the
other three — replace the closing clause of that paragraph:

```tsx
              over when a link runs long.
```

with:

```tsx
              over when a link runs long, and{' '}
              <strong className="font-semibold text-ink">voices</strong> are the clips your
              personas are cloned from.
```

Note the `totalAssets` metric deliberately stays jingles + SFX + beds — voices
are inputs to the DJ's speech, not audio the station plays.

- [ ] **Step 4: Add the sidebar entry**

In `web/components/admin/AdminShell.tsx`, add `Mic` to the `lucide-react`
import list, then add the child after the Beds entry:

```tsx
          { href: '/admin/imaging?tab=voices', id: 'imaging-voices', label: 'Voices', icon: Mic, tab: 'voices' },
```

- [ ] **Step 5: Run lint**

Run: `cd web && npm run lint`
Expected: clean. Common traps in this codebase: an inline `style=` prop
(forbidden), and an unused import left behind.

Do **not** run `npm run build` in `web/` while a dev server is running — it
clobbers `.next` and the dev server starts 500-ing on dynamic routes.

- [ ] **Step 6: Commit**

```bash
git add web/components/admin/imaging/VoicesSection.tsx web/components/admin/imaging/types.ts web/components/admin/imaging/ImagingPanel.tsx web/components/admin/AdminShell.tsx
git commit -m "feat(web): import voice clones from a Voices tab on /admin/imaging"
```

- [ ] **Step 7: Manual browser verification**

Bring up the worktree dev stack (`subwave-worktree-dev` skill) with the
`tts-heavy` profile, then at `http://localhost:7700/admin/imaging?tab=voices`:

1. The Voices tab appears in both the in-page tab row and the sidebar submenu,
   and the deep link opens it directly.
2. Import an **mp3** → it lands in the list as `<name>.wav` with a plausible
   duration and size.
3. The play button auditions the stored clip.
4. Import a very short clip (<4s) → the "under 4s" advisory renders and the
   file is still stored.
5. Open `/admin/personas`, pick a Chatterbox persona → the new voice is in the
   dropdown with no controller restart, and its TTS preview speaks in it.
6. Delete it → it leaves both the list and the persona dropdown.

---

### Task 5: Point the existing hints at the new tab

Four call sites still tell operators to FTP files onto the host. They keep the
host-folder mention (it still works) but lead with the UI.

**Files:**
- Modify: `web/components/admin/personas/PersonaVoiceCard.tsx` (Chatterbox hint, PocketTTS hint)
- Modify: `web/components/admin/settings/TtsSection.tsx` (Chatterbox hint, Chatterbox empty-folder hint, PocketTTS hint)

**Interfaces:** none — copy changes plus a `next/link` import in each file.

- [ ] **Step 1: Update the Personas hints**

In `web/components/admin/personas/PersonaVoiceCard.tsx`, add at the top with the
other imports:

```tsx
import Link from 'next/link';
```

Replace the Chatterbox `field-hint` block:

```tsx
                <div className="field-hint">
                  ~5s of clean speech is enough to clone a voice. Drop WAVs into{' '}
                  <code>{cbDir}</code> on the host and they’ll show up here.
                  Chatterbox also voices paralinguistic tags ([laugh], [sigh], …) the
                  DJ may insert.
                </div>
```

with:

```tsx
                <div className="field-hint">
                  ~5s of clean speech is enough to clone a voice.{' '}
                  <Link href="/admin/imaging?tab=voices" className="underline">Import one on the Voices page</Link>
                  {' '}— or drop WAVs into <code>{cbDir}</code> on the host — and it’ll show up
                  here. Chatterbox also voices paralinguistic tags ([laugh], [sigh], …) the
                  DJ may insert.
                </div>
```

Replace the PocketTTS `field-hint` block:

```tsx
                <div className="field-hint">
                  CPU-only, ~6× real-time. Built-in voices cover English, French, German,
                  Italian, Spanish and Portuguese. Drop a ~5s WAV into{' '}
                  <code>state/voices/</code> to clone a voice; it’ll appear under
                  <em> Custom</em> on next reload (cloning needs <code>HF_TOKEN</code>; see above).
                </div>
```

with:

```tsx
                <div className="field-hint">
                  CPU-only, ~6× real-time. Built-in voices cover English, French, German,
                  Italian, Spanish and Portuguese. To clone one,{' '}
                  <Link href="/admin/imaging?tab=voices" className="underline">import a ~5s clip on the Voices page</Link>
                  {' '}and it’ll appear under <em>Custom</em> (cloning needs <code>HF_TOKEN</code>;
                  see above).
                </div>
```

- [ ] **Step 2: Update the Settings → Voice hints**

In `web/components/admin/settings/TtsSection.tsx`, add the `next/link` import,
then replace the Chatterbox populated-list hint:

```tsx
                  <div className="field-hint">
                    ~5 seconds of clean speech is enough to clone a voice. Drop WAVs into{' '}
                    <code>state/voices/</code>
                    {' '}on the host (the legacy <code>state/chatterbox-voices/</code> is
                    still read) and they’ll appear here on next reload. Personas can
                    override this on the Personas page.
                  </div>
```

with:

```tsx
                  <div className="field-hint">
                    ~5 seconds of clean speech is enough to clone a voice.{' '}
                    <Link href="/admin/imaging?tab=voices" className="underline">Import one on the Voices page</Link>
                    {' '}— or drop WAVs into <code>state/voices/</code> on the host (the legacy{' '}
                    <code>state/chatterbox-voices/</code> is still read). Personas can
                    override this on the Personas page.
                  </div>
```

Replace the Chatterbox empty-folder hint:

```tsx
                <div className="field-hint">
                  No reference voices found in{' '}
                  <code>state/voices/</code>{' '}
                  (legacy <code>state/chatterbox-voices/</code> also empty). The engine will
                  use its built-in default voice. Drop a 5-second WAV into that directory
                  to enable cloning.
                </div>
```

with:

```tsx
                <div className="field-hint">
                  No reference voices yet, so the engine uses its built-in default voice.{' '}
                  <Link href="/admin/imaging?tab=voices" className="underline">Import a 5-second clip on the Voices page</Link>
                  {' '}to enable cloning.
                </div>
```

Replace the PocketTTS hint's cloning sentence:

```tsx
                    100M-param CPU-only model from kyutai-labs. Built-in voices speak
                    English, French, German, Italian, Spanish and Portuguese. Drop a
                    ~5-second WAV into <code>state/voices/</code> to clone a voice and it
                    will appear under <em>Custom</em> on next reload. Personas can override
                    this on the Personas page.
```

with:

```tsx
                    100M-param CPU-only model from kyutai-labs. Built-in voices speak
                    English, French, German, Italian, Spanish and Portuguese. To clone a
                    voice,{' '}
                    <Link href="/admin/imaging?tab=voices" className="underline">import a ~5-second clip on the Voices page</Link>
                    {' '}and it will appear under <em>Custom</em>. Personas can override this
                    on the Personas page.
```

- [ ] **Step 3: Run lint**

Run: `cd web && npm run lint`
Expected: clean.

- [ ] **Step 4: Verify the links in the browser**

At `/admin/personas` (a Chatterbox persona) and `/admin/settings` (Voice
section), each hint link navigates to the Voices tab.

- [ ] **Step 5: Commit**

```bash
git add web/components/admin/personas/PersonaVoiceCard.tsx web/components/admin/settings/TtsSection.tsx
git commit -m "feat(web): point the voice hints at the new Voices import page"
```

---

### Task 6: Document the feature

**Files:**
- Modify: `CLAUDE.md` (the "Shared reference-WAV folder" bullet under Heavy TTS engines)
- Modify: `controller/CLAUDE.md` (same bullet — it carries the detailed version)

- [ ] **Step 1: Update the root `CLAUDE.md`**

In the "Heavy TTS engines" section, the shared-folder sentence currently reads
that clone references live in `config.voices.dir`. Add, after the existing
`chatterbox.listReferenceVoices()` sentence:

> The folder's single owner is `audio/voice-library.ts` (`scan()` — readdir+stat, what `listReferenceVoices()` and therefore every `/settings` poll uses; `list()` — adds ffprobe'd durations, admin-only). Operators import clips from `/admin/imaging?tab=voices` (`routes/voices.ts`), stored as mono 24 kHz WAV; dropping files in by hand still works, which is exactly why there's **no JSON sidecar** — a sidecar would carry no entry for hand-dropped files. Length is advisory (4–20s), never enforced.

- [ ] **Step 2: Mirror it in `controller/CLAUDE.md`**

Add the same paragraph to the "Shared reference-WAV folder" bullet in
`controller/CLAUDE.md`, plus the traversal rule:

> `:file` route params resolve through `voice-library.resolve()` (basename check + must be present in the real scan) and are never interpolated into a path.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md controller/CLAUDE.md
git commit -m "docs: describe the voice-library module and the Voices import page"
```

---

## Wrap-up

- [ ] Run the full gate one more time: `cd controller && npm test && npm run lint`, then `cd web && npm run lint`.
- [ ] Push the branch and open a **draft PR against `develop`** (never `main`), with no Claude Code attribution in the body.
