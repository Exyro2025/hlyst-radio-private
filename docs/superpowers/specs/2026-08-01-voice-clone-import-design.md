# Import voice clones through the admin UI

**Status:** design, approved for planning
**Date:** 2026-08-01
**Origin:** Discord feature request — *"Let me import chatterbox sound files through the UI instead of having to FTP in and drop them in the voice folder manually, like how sound effects work."*

## Problem

`state/voices/` is the shared reference-WAV folder for zero-shot voice cloning
(Chatterbox and PocketTTS both read it — issue #213). Today the application only
ever **reads** that folder:

- `chatterbox.listReferenceVoices()` scans it (plus the legacy
  `state/chatterbox-voices/`) and returns `.wav` filenames.
- `GET /settings` publishes that list twice, as `tts.chatterboxVoices` and
  `tts.pocketTtsCustomVoices`.
- The Personas voice picker and Settings → TTS render it into a dropdown, with a
  hint that literally says *"Drop WAVs into `state/voices/` on the host."*

There is no write path. To add a voice an operator must reach the host
filesystem — FTP, `docker cp`, or a shell on the box. Every other operator audio
asset (jingles, sound effects, beds) already has a first-class import flow on
`/admin/imaging`, so this is an unexplained gap rather than a deliberate one.

The same folder also holds custom Piper voices (`.onnx` + `.onnx.json` pairs,
issue #230). Those are model files rather than recordings and are **out of scope**
here; see Non-goals.

## Goals

1. Upload a voice-clone reference clip from `/admin/imaging`, in the same shape
   as the existing SFX import.
2. Accept ordinary audio files (mp3, m4a, ogg, flac, wav …), not just correctly
   formatted WAVs — the operator should be able to drop a phone recording.
3. List, audition, and delete what's in the folder, including files that were
   put there the old way.
4. Point the existing "drop WAVs on the host" hints at the new UI.

## Non-goals

Deliberately excluded from this pass, each because it is a separable chunk of
work rather than because it's unwanted:

- **Custom Piper `.onnx` voice upload.** A different file type with a two-file
  validity rule and no cloning semantics.
- **Renaming a voice.** Needs a rewrite path across every persona and the
  default-engine setting that references the old filename.
- **In-use guard on delete.** Deleting a referenced voice already degrades
  gracefully: the picker shows the value with a `missing` hint and the workers
  fall back to their built-in voice with a logged reason.
- **Browser mic recording.** MediaRecorder capture is a meaningfully larger
  feature and reads better as a follow-up on top of this one.
- **Cloud-provider voice management** (ElevenLabs/OpenAI voice IDs). Those aren't
  files and don't live in this folder.

## Design

### Placement

A fourth tab on `/admin/imaging` — `?tab=voices`, beside Jingles / SFX / Beds.
That page is already the station's audio-asset library, it has the tab scaffold,
the deep-link plumbing, and the shared `DropZone` / `PanelBox` / `MetaLine`
parts, so this adds one section rather than a new page and a new nav slot.

Two places must agree on the tab set, as they do today for the other three:
`TAB_IDS` in `ImagingPanel.tsx`, and the Imaging submenu in `AdminShell.tsx`.

### Backend

**New module `controller/src/audio/voice-library.ts`** — owns the folder. It
becomes the *single scanner* of the voice directories; `chatterbox.listReferenceVoices()`
is refactored to delegate to it and keeps its current signature
(`Promise<string[]>` of filenames), because the root `CLAUDE.md` names it the
single listing path and `/settings` calls it on every poll. Two entry points, so
the cheap path stays cheap:

- `scan(): Promise<VoiceFile[]>` — `readdir` + `stat` only, no subprocess.
  Merges canonical and legacy dirs, canonical wins on filename clash, sorted.
  Each entry carries `{ file, dir, legacy, size, mtimeMs }`.
- `list(): Promise<VoiceEntry[]>` — `scan()` plus a measured `durationSec`.

**Duration is measured on demand and memoised, not stored in a sidecar.** The
memo is keyed on `file:size:mtimeMs`, so a re-uploaded or hand-replaced file
re-probes and an unchanged one never does. A sidecar JSON (the `sfx.json`
pattern) is the wrong shape here specifically because this folder is *documented
as operator-writable by hand* — a sidecar would carry no entry for every
FTP-dropped file and would go stale whenever someone keeps using the old route,
which this feature does not remove. The memo also protects the 3s admin poll
from spawning an `ffprobe` per voice per tick.

**Import — `importVoice(buffer, { name, originalName })`:**

1. `slugify(name)` → `<slug>.wav`. Rejects an empty slug.
2. Rejects an unsupported source type via the shared `isAcceptedAudio()`.
3. Rejects a filename that already exists in either dir — same reasoning as
   `sfx.importAudio`: a silent clobber would swap the voice out from under every
   persona pointing at that name. Delete first, then re-import.
4. **ffmpeg transcode to mono 24 kHz `pcm_s16le` WAV.** Both cloning workers
   resample internally, so 24 kHz mono is a safe canonical form and keeps files
   small; the transcode is also what validates the upload is decodable audio.
5. Measures duration via the existing `probeDurationSec()`.

`transcodeAudio()` gains optional `sampleRate` / `channels` options (`-ar` /
`-ac`). It is the shared import helper, so the knobs live there rather than in a
second ffmpeg wrapper.

**When ffmpeg is absent** the SFX fallback — store the raw bytes under the
original extension — is *not* safe here and must not be copied. The `.wav`
extension is load-bearing twice over: `listReferenceVoices()` filters on it, and
the workers need the bytes to actually be a WAV. So on a bare-host dev box
without ffmpeg, a `.wav` upload is stored as-is and anything else is refused with
a message naming the missing tool. The Docker images all ship ffmpeg, so this
only affects `npm start` on a bare host.

**Length: warn, never trim or reject.** The stored file is exactly what was
uploaded. `list()` returns `durationSec`, and a pure `voiceWarning(durationSec)`
classifies it against two exported constants — `ADVISORY_MIN_SEC = 4` and
`ADVISORY_MAX_SEC = 20` — returning `'short'`, `'long'`, or `null` (also `null`
when the duration is unknown). Under 4s there may not be enough signal for a
stable clone; over 20s every render gets slower without sounding better. The
operator decides. The 25 MB `audioUpload` cap remains the only hard limit, and
length never blocks an import.

**Delete — `removeVoice(file)`** resolves through `scan()` and unlinks from
whichever directory the file actually lives in, so legacy-folder files are
manageable too.

**New route file `controller/src/routes/voices.ts`**, mounted in `server.ts`
next to `sfxRoutes`. All four are `requireAdmin`:

| Route | Purpose |
| --- | --- |
| `GET /voices` | `{ voices, dir, legacyDir, ffmpeg }` — list + the folder path for the hint, + whether transcoding is available |
| `POST /voices/upload` | multipart `file` + `name`, via the existing `audioUpload('file')` middleware |
| `DELETE /voices/:file` | remove one |
| `GET /voices/:file/audio` | stream the stored clip back for audition |

**Path-traversal rule:** `:file` is never interpolated into a path. Both the
delete and audio routes look the parameter up in `scan()` and use the resolved
absolute path from that entry, so anything not currently listed is a 404. This is
the one security-relevant surface in the change and it gets a test.

**Multi-station:** `config.voices.dir` derives from `STATE_DIR`, which is the
*active* station dir, and `stations/pure.ts` already classifies `voices` as
station-level (moves on conversion, copies on duplicate). Uploads therefore land
in the active station's folder with no new plumbing. **Sidecar mode:** the
`tts-heavy` container mounts the same `/var/sub-wave` volume, so an uploaded file
is visible to the sidecar immediately — no restart, no copy step.

### Frontend

**`web/components/admin/imaging/VoicesSection.tsx`**, following `SfxSection`:

- `SectionMasthead` with an *Import* action and a `TabMetric` voice count.
- A `PanelBox` library list. Each row: filename, `MetaLine` with duration + size
  + a `legacy` badge where applicable, a `PreviewButton` pointed at
  `/voices/<file>/audio`, and a delete button behind the page's existing
  confirm-delete modal.
- Rows whose `voiceWarning()` is non-null carry an inline advisory — visible,
  not blocking.
- `EmptyState` when the folder is empty, explaining that ~5 seconds of clean
  speech is enough to clone a voice.
- Import modal: `DropZone` file picker + a name field defaulted from the
  uploaded filename via the existing `baseName()` helper.

**`ImagingPanel.tsx`** gains `'voices'` in `TabId`/`TAB_IDS`, a `voicesData`
fetch on the existing 3s poll, and `uploadVoice` / `deleteVoice` handlers shaped
like `uploadSfx` / the SFX delete. **`types.ts`** gains `VoiceEntry` / `VoiceData`.
**`AdminShell.tsx`** gains the submenu entry.

**Hints updated to point here** — four call sites, two files:
`PersonaVoiceCard.tsx` (Chatterbox + PocketTTS blocks) and `TtsSection.tsx`
(same two engines, including its empty-folder branch). The host-folder path stays
mentioned as the secondary route, since dropping files on disk keeps working.

### Testing

`controller/scripts/voice-library.test.ts` — dropped into `scripts/` is the whole
registration step. Pure/near-pure coverage, no ffmpeg required:

- `voiceWarning(durationSec)` — under/over/inside the band, and `null` duration.
- Filename derivation: slugify, forced `.wav`, empty-slug rejection.
- Duplicate-name rejection across both canonical and legacy dirs.
- Traversal: `../`, absolute paths, and an unlisted name all resolve to "not
  found" rather than a filesystem path.
- The duration memo: same key doesn't re-probe, changed `mtimeMs` does.

Lint (`npm run lint` in `controller/` and `web/`) is the merge gate; `npm test`
in `controller/` is run locally before pushing since CI doesn't.

### Manual verification

Against the dev stack with the `tts-heavy` profile up: import an mp3 → it appears
as a `.wav`, auditions correctly, shows a plausible duration, is selectable in
the Personas Chatterbox picker without a controller restart, and renders a TTS
preview in that voice. Then delete it and confirm it leaves both the list and the
picker.

## Risks

- **Refactoring `listReferenceVoices()` onto the shared scanner** touches a path
  that `/settings` hits on every admin poll. The mitigation is the split above:
  it delegates to `scan()`, which is `readdir` + `stat` — the same work it does
  today — and never to the probing `list()`.
- **A very long upload** is accepted by design. It costs render time on every
  spoken segment for that persona, which is why the advisory exists; the 25 MB
  cap bounds the worst case.
