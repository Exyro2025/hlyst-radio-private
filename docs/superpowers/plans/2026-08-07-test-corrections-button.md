# Test corrections button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Test corrections" control to `admin → Moods → Speech` that
synthesizes a typed sentence through the station's default TTS voice with
the tab's *current* (possibly unsaved) speech-correction rules applied.

**Architecture:** Extend the existing `POST /settings/tts/preview` endpoint
(already used by every other "Play sample" button in the admin UI) to accept
an optional `corrections` override, sanitized by a new pure helper in
`audio/speech-text.ts`. Thread `text`/`corrections` props through the
existing `VoicePreviewButton` component. `MoodsPanel.tsx`'s Speech tab reads
the station's default engine/voice from the settings payload it already
fetches and renders a text input + the preview button, sending the tab's
live (unsaved) correction rows.

**Tech Stack:** Node.js/Express controller (TypeScript, ESM, `tsx`), Next.js
15 admin UI (TypeScript/React), no new dependencies.

## Global Constraints

- Corrections sanitizer caps: ≤100 rows, `from` ≤80 chars, `to` ≤160 chars
  (mirrors `MoodsPanel.tsx`'s existing `Input maxLength`s and 100-row cap).
- Test-sentence input: `maxLength={200}` (mirrors server's
  `PREVIEW_TEXT_MAX`).
- Omitting the new `corrections` param from `synthesizeSample()` must leave
  every existing call site byte-for-byte unchanged (falls through to saved
  `settings.tts.corrections`).
- No new engine/voice picker — uses `settings.tts.defaultEngine` and that
  engine's already-configured voice, read-only in this tab.
- `controller/` lint is `npm run lint` (`eslint . && tsc --noEmit`); tests
  are `npm test` (auto-discovers `scripts/*.test.ts`). Run both before
  considering controller work done. `web/` has no test suite — verify with
  `npm run lint` (`eslint . && tsc --noEmit`) and a manual browser check.

---

### Task 1: Pure corrections sanitizer + unit tests

**Files:**
- Modify: `controller/src/audio/speech-text.ts`
- Modify: `controller/scripts/speech-text.test.ts`

**Interfaces:**
- Consumes: nothing new (pure module, no imports).
- Produces: `export function sanitizeSpeechCorrections(input: unknown): SpeechCorrection[]`
  — used by Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `controller/scripts/speech-text.test.ts`, after the existing
`'operator corrections (settings.tts.corrections):'` block (i.e. right
before the `// --- the display pass (#1186) ---` comment, around line 172):

```ts
  console.log('sanitizeSpeechCorrections (preview override):');
  await test('non-array input returns an empty list', () => {
    assert.deepEqual(sanitizeSpeechCorrections(undefined), []);
    assert.deepEqual(sanitizeSpeechCorrections(null), []);
    assert.deepEqual(sanitizeSpeechCorrections('nope'), []);
    assert.deepEqual(sanitizeSpeechCorrections({}), []);
  });
  await test('valid rows pass through unchanged', () => {
    assert.deepEqual(
      sanitizeSpeechCorrections([{ from: 'GHz', to: 'gigahertz' }]),
      [{ from: 'GHz', to: 'gigahertz' }],
    );
  });
  await test('rows with a blank/missing `from` are dropped', () => {
    assert.deepEqual(sanitizeSpeechCorrections([{ from: '', to: 'x' }]), []);
    assert.deepEqual(sanitizeSpeechCorrections([{ to: 'x' }]), []);
    assert.deepEqual(sanitizeSpeechCorrections([{ from: '   ', to: 'x' }]), []);
  });
  await test('non-string `to` becomes an empty string, not dropped', () => {
    assert.deepEqual(
      sanitizeSpeechCorrections([{ from: 'literally', to: 42 }]),
      [{ from: 'literally', to: '' }],
    );
  });
  await test('malformed rows (non-object, null) are skipped, not thrown', () => {
    assert.deepEqual(
      sanitizeSpeechCorrections([null, 'x', 42, { from: 'ok', to: 'yes' }]),
      [{ from: 'ok', to: 'yes' }],
    );
  });
  await test('`from` is truncated at 80 chars, `to` at 160', () => {
    const longFrom = 'a'.repeat(90);
    const longTo = 'b'.repeat(200);
    const result = sanitizeSpeechCorrections([{ from: longFrom, to: longTo }]);
    assert.equal(result[0].from.length, 80);
    assert.equal(result[0].to.length, 160);
  });
  await test('capped at 100 rows, extras dropped', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ from: `w${i}`, to: `x${i}` }));
    assert.equal(sanitizeSpeechCorrections(rows).length, 100);
    // the FIRST 100 survive, not an arbitrary subset
    assert.equal(sanitizeSpeechCorrections(rows)[0].from, 'w0');
    assert.equal(sanitizeSpeechCorrections(rows)[99].from, 'w99');
  });
```

Also update the import line near the top of the file (currently):

```ts
import {
  normalizeForDisplay, normalizeForSpeech, spokenWordScale,
} from '../src/audio/speech-text.js';
```

to:

```ts
import {
  normalizeForDisplay, normalizeForSpeech, spokenWordScale, sanitizeSpeechCorrections,
} from '../src/audio/speech-text.js';
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `cd controller && npm test -- speech-text`
Expected: FAIL — `sanitizeSpeechCorrections` is not exported (a
`SyntaxError`/`TypeError` on import, or an assertion failure if the name
resolves to `undefined`).

- [ ] **Step 3: Implement the sanitizer**

In `controller/src/audio/speech-text.ts`, add below the existing
`applyCorrections` function (after line 65, before the `DOLLAR_MAGNITUDE`
comment block):

```ts
// Sanitizes an UNTRUSTED corrections array for the admin "Test corrections"
// preview (routes/settings/tts.ts POST /settings/tts/preview) — the operator
// can send the tab's UNSAVED working rows, so this can't reuse
// settings/validate.ts's persistence-path validator (which throws). Lenient
// like normalizeForSpeech's own per-row skip: a malformed row is dropped,
// never a 400, because this never gets written to disk.
const PREVIEW_CORRECTIONS_MAX = 100;
const CORRECTION_FROM_MAX = 80;
const CORRECTION_TO_MAX = 160;

export function sanitizeSpeechCorrections(input: unknown): SpeechCorrection[] {
  if (!Array.isArray(input)) return [];
  const out: SpeechCorrection[] = [];
  for (const row of input) {
    if (out.length >= PREVIEW_CORRECTIONS_MAX) break;
    if (!row || typeof row !== 'object') continue;
    const rawFrom = (row as Record<string, unknown>).from;
    const rawTo = (row as Record<string, unknown>).to;
    const from = typeof rawFrom === 'string' ? rawFrom.slice(0, CORRECTION_FROM_MAX) : '';
    if (!from.trim()) continue;
    const to = typeof rawTo === 'string' ? rawTo.slice(0, CORRECTION_TO_MAX) : '';
    out.push({ from, to });
  }
  return out;
}
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `cd controller && npm test -- speech-text`
Expected: PASS (`all passing`)

- [ ] **Step 5: Commit**

```bash
git add controller/src/audio/speech-text.ts controller/scripts/speech-text.test.ts
git commit -m "feat(controller): add sanitizeSpeechCorrections for the corrections preview override"
```

---

### Task 2: Wire the corrections override into `synthesizeSample()`

**Files:**
- Modify: `controller/src/audio/tts.ts:14` (import), `controller/src/audio/tts.ts:307-343` (function)

**Interfaces:**
- Consumes: `sanitizeSpeechCorrections` from Task 1 (`./speech-text.js`).
- Produces: `synthesizeSample()` accepts a new optional `corrections?: unknown`
  param — used by Task 3 (the route).

- [ ] **Step 1: Update the import**

In `controller/src/audio/tts.ts`, change line 14 from:

```ts
import { normalizeForSpeech } from './speech-text.js';
```

to:

```ts
import { normalizeForSpeech, sanitizeSpeechCorrections } from './speech-text.js';
```

- [ ] **Step 2: Add the param to `synthesizeSample()`'s signature**

Locate the destructured parameter list (currently starting at line 308):

```ts
export async function synthesizeSample(
  { engine, voice = '', cloudProvider = 'openai', cloudModel, speed, lang, language, text, voiceSettings, fishSettings: requestedFishSettings, signal }: {
```

Change to:

```ts
export async function synthesizeSample(
  { engine, voice = '', cloudProvider = 'openai', cloudModel, speed, lang, language, text, corrections, voiceSettings, fishSettings: requestedFishSettings, signal }: {
```

And add the type entry right after the `text?: string;` line (currently
line 321, in the type object below the destructure):

```ts
    text?: string;
    // Unsaved corrections override (admin "Test corrections" button, Speech
    // tab) — when present, used INSTEAD of settings.tts.corrections for this
    // one synth call. Sanitized by sanitizeSpeechCorrections; malformed input
    // degrades to no corrections rather than throwing.
    corrections?: unknown;
```

- [ ] **Step 3: Use it when building the sample text**

Change line 343 from:

```ts
  const sample = normalizeForSpeech(raw.slice(0, PREVIEW_TEXT_MAX), settings.get().tts?.corrections);
```

to:

```ts
  const activeCorrections = corrections !== undefined
    ? sanitizeSpeechCorrections(corrections)
    : settings.get().tts?.corrections;
  const sample = normalizeForSpeech(raw.slice(0, PREVIEW_TEXT_MAX), activeCorrections);
```

- [ ] **Step 4: Typecheck**

Run: `cd controller && npm run lint`
Expected: PASS, no new `tsc`/`eslint` errors.

- [ ] **Step 5: Re-run the full controller test suite**

Run: `cd controller && npm test`
Expected: PASS — confirms nothing else regressed (this task touches a
shared, heavily-used file).

- [ ] **Step 6: Commit**

```bash
git add controller/src/audio/tts.ts
git commit -m "feat(controller): synthesizeSample accepts an unsaved corrections override"
```

---

### Task 3: Forward `corrections` through the preview route

**Files:**
- Modify: `controller/src/routes/settings/tts.ts:50-66`

**Interfaces:**
- Consumes: `synthesizeSample({ …, corrections })` from Task 2.
- Produces: `POST /settings/tts/preview` accepts `corrections` in its JSON
  body — used by Task 4 (`previewApi.ts`).

- [ ] **Step 1: Add the field to the `synthesizeSample` call**

In `controller/src/routes/settings/tts.ts`, the call currently reads (lines
50-66):

```ts
    filePath = await tts.synthesizeSample({
      engine,
      voice: typeof body.voice === 'string' ? body.voice : '',
      cloudProvider: typeof body.cloudProvider === 'string' ? body.cloudProvider : 'openai',
      cloudModel: typeof body.cloudModel === 'string' ? body.cloudModel : undefined,
      speed: typeof body.speed === 'number' ? body.speed : undefined,
      lang: typeof body.lang === 'string' ? body.lang : undefined,
      language: typeof body.language === 'string' ? body.language : undefined,
      text: typeof body.text === 'string' ? body.text : undefined,
      voiceSettings: (body.voiceSettings && typeof body.voiceSettings === 'object')
        ? body.voiceSettings
        : undefined,
      fishSettings: (body.fishSettings && typeof body.fishSettings === 'object')
        ? body.fishSettings
        : undefined,
      signal: previewAbort.signal,
    });
```

Add a `corrections` line after `text`:

```ts
    filePath = await tts.synthesizeSample({
      engine,
      voice: typeof body.voice === 'string' ? body.voice : '',
      cloudProvider: typeof body.cloudProvider === 'string' ? body.cloudProvider : 'openai',
      cloudModel: typeof body.cloudModel === 'string' ? body.cloudModel : undefined,
      speed: typeof body.speed === 'number' ? body.speed : undefined,
      lang: typeof body.lang === 'string' ? body.lang : undefined,
      language: typeof body.language === 'string' ? body.language : undefined,
      text: typeof body.text === 'string' ? body.text : undefined,
      corrections: Array.isArray(body.corrections) ? body.corrections : undefined,
      voiceSettings: (body.voiceSettings && typeof body.voiceSettings === 'object')
        ? body.voiceSettings
        : undefined,
      fishSettings: (body.fishSettings && typeof body.fishSettings === 'object')
        ? body.fishSettings
        : undefined,
      signal: previewAbort.signal,
    });
```

- [ ] **Step 2: Update the route's doc comment**

Extend the comment block above the route (lines 17-30) — after `lang?,
language?, text?,` add `corrections?,`:

```ts
// POST /settings/tts/preview — synthesize a short sample in an EXPLICIT engine +
// voice (not the on-air persona) so the admin "Play sample" button can audition
// a voice/speed before saving. Body: { engine, voice?, cloudProvider?, cloudModel?, speed?,
// lang?, language?, text?, corrections?, voiceSettings?, fishSettings? } — `language` is the persona's
// free-text on-air language; when set (and no explicit text), the sample
// sentence is rendered in that language. `corrections` is an UNSAVED
// {from,to}[] override (admin "Test corrections" button, Speech tab) — when
// present it replaces settings.tts.corrections for this call, sanitized
// server-side by sanitizeSpeechCorrections. voiceSettings carries UNSAVED ElevenLabs
// slider values (issue #696) so the operator can tune the expressive knobs by
// ear before saving; fishSettings does the same for temperature/top-p/latency.
// synthesizeSample clamps them like settings.update() does.
```

- [ ] **Step 3: Typecheck + full test suite**

Run: `cd controller && npm run lint && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add controller/src/routes/settings/tts.ts
git commit -m "feat(controller): POST /settings/tts/preview accepts an unsaved corrections override"
```

---

### Task 4: Thread `text`/`corrections` through the web preview client + button

**Files:**
- Modify: `web/components/admin/tts/previewApi.ts`
- Modify: `web/components/admin/tts/VoicePreviewButton.tsx`

**Interfaces:**
- Consumes: `POST /settings/tts/preview` body shape from Task 3.
- Produces: `PreviewParams.text?: string`, `PreviewParams.corrections?:
  {from:string;to:string}[]`; `VoicePreviewButtonProps.text?`,
  `VoicePreviewButtonProps.corrections?` — used by Task 5 (`MoodsPanel.tsx`).

- [ ] **Step 1: Extend `PreviewParams`**

In `web/components/admin/tts/previewApi.ts`, add two fields to the
`PreviewParams` interface, after `language?: string;` (currently line 19):

```ts
  // Free-text on-air language ("Turkish", "Türkçe"); the server renders the sample
  // sentence in it, falling back to English when it doesn't recognize it.
  language?: string;
  // Explicit sample text, overriding both the default sentence and the
  // language-localized one. Truncated server-side at PREVIEW_TEXT_MAX (200).
  text?: string;
  // Unsaved corrections override (admin "Test corrections" button, Moods →
  // Speech tab) — tests the tab's CURRENT rows, saved or not.
  corrections?: { from: string; to: string }[];
```

No change is needed to `fetchPreviewSample()` itself — it already
`JSON.stringify(params)`s the whole object, so the two new optional fields
ride along for free.

- [ ] **Step 2: Extend `VoicePreviewButtonProps` and forward the fields**

In `web/components/admin/tts/VoicePreviewButton.tsx`:

Add to the props interface, after `language?: string;` (currently around
line 32):

```ts
  // Persona's free-text on-air language ("Turkish", "Türkçe") — the server
  // renders the sample sentence in this language when it recognizes it.
  language?: string;
  // Explicit sample text (overrides the default/localized sentence).
  text?: string;
  // Unsaved corrections override — tests rules that haven't been saved yet.
  corrections?: { from: string; to: string }[];
```

Add `text` and `corrections` to the function's destructured params
(currently line 54):

```ts
export function VoicePreviewButton({
  engine, voice, cloudProvider, cloudModel, speed, lang, language, text, corrections, voiceSettings, fishSettings, adminFetch, disabled, className,
}: VoicePreviewButtonProps) {
```

Forward them in the `fetchPreviewSample` call inside `onClick` (currently
lines 89-93):

```ts
      const res = await fetchPreviewSample(
        adminFetch,
        { engine, voice, cloudProvider, cloudModel, speed, lang, language, text, corrections, voiceSettings, fishSettings },
        ac.signal,
      );
```

Do **not** add `text`/`corrections` to the stale-sample reset effect's
dependency array (currently lines 74-78) — same deliberate omission as
`voiceSettings`, called out in the comment right above it, because these are
fresh objects/strings on every parent render and would discard a
just-synthesized sample on every keystroke.

- [ ] **Step 3: Typecheck**

Run: `cd web && npm run lint`
Expected: PASS, no new `tsc`/`eslint` errors. (No behavior change yet for
any existing caller — both new props are optional and unused so far.)

- [ ] **Step 4: Commit**

```bash
git add web/components/admin/tts/previewApi.ts web/components/admin/tts/VoicePreviewButton.tsx
git commit -m "feat(web): VoicePreviewButton accepts an explicit text + unsaved corrections override"
```

---

### Task 5: "Test corrections" UI in the Speech tab

**Files:**
- Modify: `web/components/admin/MoodsPanel.tsx`

**Interfaces:**
- Consumes: `VoicePreviewButton` with `text`/`corrections` props from Task 4;
  `Correction` interface already defined in this file (line 23-26);
  `effectiveCorr` already computed in this file (lines 164-168).
- Produces: nothing consumed elsewhere — this is the leaf UI.

- [ ] **Step 1: Import `VoicePreviewButton`**

Add near the top of `web/components/admin/MoodsPanel.tsx`, alongside the
other component imports (after the `FestivalsSection` import, currently
line 17):

```ts
import { VoicePreviewButton } from './tts/VoicePreviewButton';
```

- [ ] **Step 2: Widen the `/settings` response type and extract the default voice**

In the `load()` callback, the current response type (lines 87-94) is:

```ts
      const j = (await r.json()) as {
        values?: {
          moods?: unknown;
          moodSchedule?: unknown;
          weatherMoods?: unknown;
          tts?: { corrections?: unknown };
        };
      } | null;
```

Change the `tts` field's type to also carry the voice-resolution fields:

```ts
      const j = (await r.json()) as {
        values?: {
          moods?: unknown;
          moodSchedule?: unknown;
          weatherMoods?: unknown;
          tts?: {
            corrections?: unknown;
            defaultEngine?: string;
            kokoro?: { voice?: string };
            chatterbox?: { referenceVoice?: string };
            pocketTts?: { voice?: string };
            cloud?: { provider?: string; model?: string; voice?: string };
            speed?: Record<string, number>;
          };
        };
      } | null;
```

Right after the existing `loadedCorr` derivation (currently lines 101-102),
add the default-voice resolution — same per-engine lookup
`TtsSection.tsx:1381-1398` already does for its own "Play sample" row:

```ts
      const rawTts = v.tts || {};
      const previewEngine = rawTts.defaultEngine || 'piper';
      const previewVoiceValue =
        previewEngine === 'kokoro' ? (rawTts.kokoro?.voice || '')
        : previewEngine === 'chatterbox' ? (rawTts.chatterbox?.referenceVoice || '')
        : previewEngine === 'pocket-tts' ? (rawTts.pocketTts?.voice || '')
        : previewEngine === 'cloud' ? (rawTts.cloud?.voice || '')
        : '';
```

Then, right after the existing `setCorrections(loadedCorr);
setSavedCorrections(loadedCorr);` lines (currently 109-110), add:

```ts
      setPreviewVoice({
        engine: previewEngine,
        voice: previewVoiceValue,
        cloudProvider: rawTts.cloud?.provider,
        cloudModel: previewEngine === 'cloud' ? rawTts.cloud?.model : undefined,
        speed: rawTts.speed?.[previewEngine],
      });
```

- [ ] **Step 3: Add the new state**

Add alongside the other `useState` declarations near the top of the
component (after `const [savedCorrections, setSavedCorrections] =
useState<Correction[]>([]);`, currently line 81):

```ts
  interface TestVoiceDefaults {
    engine: string;
    voice: string;
    cloudProvider?: string;
    cloudModel?: string;
    speed?: number;
  }
  const [previewVoice, setPreviewVoice] = useState<TestVoiceDefaults>({ engine: 'piper', voice: '' });
  const [testText, setTestText] = useState('');
```

(Move the `TestVoiceDefaults` interface to file scope, next to the existing
`Correction` interface at the top of the file, rather than inline in the
component — keeps it consistent with how `MoodEntry`/`Correction` are
declared. Declare it right after the `Correction` interface, around line
26.)

- [ ] **Step 4: Render the "Test corrections" block**

In the `tab === 'speech'` block, after the existing corrections `<Card>`
closes (currently ending at line 426, right before the tab's closing `)}`
at line 427), add a second card:

```tsx
          <Card title="Test corrections" sub="hear a rule before saving, with the station's default voice">
            <div className="field">
              <div className="field-hint">
                Uses the corrections list above exactly as it stands right now, unsaved
                changes included, spoken by the station&apos;s default voice
                ({previewVoice.engine}).
              </div>
              <Input
                aria-label="Test sentence"
                value={testText}
                onChange={e => setTestText(e.target.value)}
                placeholder="Type a line using a word you corrected…"
                maxLength={200}
              />
              <VoicePreviewButton
                className="mt-3"
                engine={previewVoice.engine}
                voice={previewVoice.voice}
                cloudProvider={previewVoice.cloudProvider}
                cloudModel={previewVoice.cloudModel}
                speed={previewVoice.speed}
                text={testText}
                corrections={effectiveCorr}
                disabled={!testText.trim()}
                adminFetch={adminFetch}
              />
            </div>
          </Card>
```

- [ ] **Step 5: Typecheck**

Run: `cd web && npm run lint`
Expected: PASS, no new `tsc`/`eslint` errors.

- [ ] **Step 6: Commit**

```bash
git add web/components/admin/MoodsPanel.tsx
git commit -m "feat(web): add Test corrections button to Moods → Speech tab"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: the full feature from Tasks 1-5.
- Produces: nothing — confirms the feature works in the real app before the
  PR.

- [ ] **Step 1: Start the dev stack**

```bash
docker compose -f docker-compose.dev.yml up -d
cd web && npm install && npm run dev
```

- [ ] **Step 2: Open the admin Speech tab**

Navigate to `http://localhost:7700/admin` (sign in), then to
Moods → Speech (`?tab=speech`).

- [ ] **Step 3: Golden path**

Add a correction row: `from = "GHz"`, `to = "gigahertz"`. **Do not** click
"Save corrections". In the new "Test corrections" box, type `The chip runs
at 3 GHz`, click the preview button (label reads "Play sample" /
"Synthesizing…" per the existing button states). Confirm the audio plays
and audibly says "gigahertz", not "G H Z" — proving the UNSAVED row is what
was used (reload the page afterward and confirm the row is gone, i.e. it
really wasn't saved).

- [ ] **Step 4: Edge cases**

- Empty test text: confirm the preview button is disabled.
- No correction rows at all: confirm the button still works (plays the
  typed sentence unmodified) — corrections is an empty array, not an error.
- Click "Save corrections" first, then test again: confirm the saved rule
  still audibly applies (the saved-vs-unsaved paths both work).
- Re-click while "Synthesizing…": confirm it cancels (existing
  `VoicePreviewButton` behavior, unchanged by this feature).

- [ ] **Step 5: Confirm other preview buttons still work**

Open Settings → TTS, click its "Play sample" button once. Confirms Task 4's
prop additions didn't regress the existing callers (`TtsSection.tsx`,
`PersonaVoiceCard.tsx`, etc. — none of which pass the new props, so this is
checking for accidental breakage, not new behavior).

- [ ] **Step 6: Tear down**

```bash
docker compose -f docker-compose.dev.yml down
```

(No commit — this task is verification only.)

---

### Task 7: Open the pull request

**Files:** none

**Interfaces:** none

- [ ] **Step 1: Push the branch**

```bash
git push -u origin HEAD
```

(If still on `develop`, create a feature branch first — check `git branch
--show-current`; if it prints `develop`, run `git checkout -b
feat/test-corrections-button` before pushing, then re-run the push.)

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: Test corrections button in Moods → Speech tab" --body "$(cat <<'EOF'
## Summary
- Adds a "Test corrections" control to admin → Moods → Speech: type a sentence, hear it synthesized through the station's default voice with the tab's current (including unsaved) correction rules applied.
- `POST /settings/tts/preview` gains an optional `corrections` override, sanitized by a new pure `sanitizeSpeechCorrections()` in `audio/speech-text.ts`.
- `VoicePreviewButton`/`previewApi.ts` gain `text`/`corrections` passthrough props, unused by existing callers.

## Test plan
- [x] `cd controller && npm test` (includes new `sanitizeSpeechCorrections` unit tests in `speech-text.test.ts`)
- [x] `cd controller && npm run lint`
- [x] `cd web && npm run lint`
- [x] Manual: add an unsaved correction row, test it via the new button, confirm it speaks the corrected form and the row is still unsaved after
- [x] Manual: confirm existing "Play sample" buttons elsewhere in admin still work

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Report the PR URL to the user**

---

## Self-Review Notes

- **Spec coverage:** server sanitizer/override (Task 1-2), route wiring
  (Task 3), web passthrough props (Task 4), tab UI incl. default-voice
  resolution + `effectiveCorr` reuse (Task 5), manual verification (Task 6),
  PR (Task 7, added per this session's explicit request) — all spec sections
  covered.
- **Placeholder scan:** none found — every step has literal code or literal
  commands.
- **Type consistency:** `SpeechCorrection` (Task 1) → `synthesizeSample`'s
  `corrections?: unknown` (Task 2, deliberately unknown pre-sanitize) →
  route's `Array.isArray(body.corrections) ? body.corrections : undefined`
  (Task 3) → `PreviewParams.corrections?: {from:string;to:string}[]` (Task
  4) → `VoicePreviewButtonProps.corrections?` same shape (Task 4) →
  `effectiveCorr` (already `{from:string;to:string}[]` per existing
  `MoodsPanel.tsx` code, Task 5) — consistent end to end.
