'use client';
// Engine picker + the engine-specific voice selector + a "Play sample" button,
// for any place the operator configures a `{engine, voice, cloudProvider}` voice
// slot. Two call sites today, and they are the same shape by design — a persona
// (`personas[].tts`) and the station-wide TTS fallback (`settings.tts.fallback`,
// which the controller hands to speakWith() as a synthetic persona).
//
// Extracted from PersonaVoiceCard so the per-engine voice lists and the
// engine-change voice normalization live once. That normalization is the subtle
// part: `voice` is one field shared across engines but each engine validates it
// differently, so a leftover value from the old engine (say a Kokoro id like
// "bm_george" under pocket-tts) fails the new engine's check on save.
//
// Presentation the two call sites disagree on is passed in rather than branched
// on here: the hint under the engine grid, the wording of the red
// engine-unavailable notice (a persona "falls back to X"; the fallback slot has
// nothing behind it to name), and the hint under the sample player.
import type { ChangeEvent, ReactNode } from 'react';
import Link from 'next/link';
import type { VoiceOption } from '../personas/types';
import type { AdminAuth } from '../../../lib/adminAuth';
import { CLOUD_VOICES } from '../../../lib/cloudVoices';
import {
  buildCloudVoiceGroups, isKnownCloudVoice, providerSupportsDiscovery, CUSTOM_VOICE_ID,
} from '../../../lib/cloudVoiceGroups';
import { useVoiceDiscovery } from '../../../hooks/useVoiceDiscovery';
import {
  CB_DEFAULT_VOICE, KOKORO_RE, CHATTERBOX_VOICE_RE, POCKET_TTS_VOICE_RE,
} from '../personas/constants';
import { Seg } from '../ui';
import { EngineSelector } from './EngineSelector';
import { VoicePreviewButton } from './VoicePreviewButton';
import { VoicePicker, type VoicePickerGroup } from './VoicePicker';
import { ENGINES, type EngineAvailability } from './engineMeta';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup,
} from '../../ui/select';
import { cn } from '../../../lib/cn';

const ENGINE_IDS = ENGINES.map(e => e.id);

// The three fields every voice slot carries. Matches the controller's shared
// voice-slot shape (settings/validate.ts validateTtsBlock).
export interface VoiceSlot {
  engine: string;
  voice: string;
  cloudProvider: string;
}

// Why an engine can't speak right now, and how to bring it up — the shared
// first half of the red notice. Each call site appends its own consequence
// ("this persona falls back to X", "the fallback can't rescue anything"), which
// is the only part that differs. JSX, so it lives here rather than in the
// deliberately React-free engineMeta.ts.
export const ENGINE_UNAVAILABLE: Record<string, ReactNode> = {
  chatterbox: (
    <>
      Chatterbox isn’t currently available. It lives in the optional{' '}
      <code>tts-heavy</code> sidecar. Start it with{' '}
      <code>docker compose --profile tts-heavy up -d</code> (or set{' '}
      <code>COMPOSE_PROFILES=tts-heavy</code> in <code>.env</code>).
    </>
  ),
  'pocket-tts': (
    <>
      PocketTTS isn’t currently available. It lives in the same optional{' '}
      <code>tts-heavy</code> sidecar as Chatterbox. Start it with{' '}
      <code>docker compose --profile tts-heavy up -d</code> (or set{' '}
      <code>COMPOSE_PROFILES=tts-heavy</code> in <code>.env</code>).
    </>
  ),
  remote: (
    <>
      The remote endpoint isn’t reachable. Configure its URL in
      Settings &rarr; Voice.
    </>
  ),
};

// Just the slice of GET /settings this component reads. Deliberately structural
// rather than either page's own response type: the Personas page and the
// Settings page model the rest of that payload differently, and neither
// difference is any of this component's business.
export interface EngineVoiceData {
  tts?: {
    kokoroVoices?: string[];
    kokoroVoiceLanguages?: Record<string, string>;
    piperVoices?: string[];
    chatterboxVoices?: string[];
    pocketTtsVoices?: VoiceOption[];
    pocketTtsCustomVoices?: string[];
    available?: EngineAvailability;
    cloudProviders?: string[];
  };
}

interface EngineVoiceFieldsProps {
  value: VoiceSlot;
  onChange: (patch: Partial<VoiceSlot>) => void;
  data: EngineVoiceData | null;
  adminFetch: AdminAuth['adminFetch'];
  // Preview context. `speed` auditions the slot's own rate where the slot has
  // one (personas); the fallback slot has no speed of its own, so it previews
  // at the engine's pace.
  previewSpeed?: number;
  previewLanguage?: string;
  // Rendered in place of the red notice body when `engine` can't currently
  // speak — the caller supplies the wording and the consequence.
  unavailableNote: (engine: string) => ReactNode;
  // Cloud-specific "this won't play" notice (missing key, disabled engine).
  cloudIssue?: ReactNode;
  engineHint?: ReactNode;
  previewHint?: ReactNode;
}

export function EngineVoiceFields({
  value, onChange, data, adminFetch,
  previewSpeed, previewLanguage,
  unavailableNote, cloudIssue, engineHint, previewHint,
}: EngineVoiceFieldsProps) {
  const kokoroVoices: string[] = data?.tts?.kokoroVoices || [];
  const kokoroLanguages = data?.tts?.kokoroVoiceLanguages || {};
  const pocketTtsVoices = data?.tts?.pocketTtsVoices || [];
  const cloudProviders = data?.tts?.cloudProviders || ['openai', 'elevenlabs'];

  // Voices offered by this slot's cloud provider. The server falls back to the
  // saved base URL when we don't send one, which is right here: every slot uses
  // the station-wide openai-compatible server. ElevenLabs and Fish are gated on
  // a key actually being set, so we don't fire a request we know will fail.
  const cloudProvider = value.cloudProvider;
  const elevenLabsReady = data?.tts?.available?.cloudByProvider?.elevenlabs !== false;
  const fishReady = data?.tts?.available?.cloudByProvider?.['fish-audio'] !== false;
  const voiceDiscovery = useVoiceDiscovery({
    provider: cloudProvider,
    enabled: value.engine === 'cloud'
      && providerSupportsDiscovery(cloudProvider)
      && (cloudProvider !== 'elevenlabs' || elevenLabsReady)
      && (cloudProvider !== 'fish-audio' || fishReady),
    adminFetch,
  });
  const discoveredVoices = voiceDiscovery.voices;

  // Engine change: normalize `voice` to something the target engine accepts,
  // otherwise a leftover from the previous engine fails validation on save.
  const selectEngine = (v: string) => {
    const patch: Partial<VoiceSlot> = { engine: v };
    const cur = value.voice.trim();
    if (v === 'cloud') {
      // A discovered voice counts as valid too — otherwise toggling the engine
      // away and back silently destroys a voice the operator picked from the
      // server's own list.
      if (!isKnownCloudVoice(cloudProvider, discoveredVoices, cur)) {
        const provVoices = CLOUD_VOICES[cloudProvider as keyof typeof CLOUD_VOICES] || [];
        patch.voice = provVoices[0]?.id || cur;
      }
    } else if (v === 'kokoro') {
      if (!KOKORO_RE.test(cur)) patch.voice = 'bf_isabella';
    } else if (v === 'chatterbox') {
      // Empty = built-in voice; a real value must be a .wav filename.
      if (cur && !CHATTERBOX_VOICE_RE.test(cur)) patch.voice = '';
    } else if (v === 'pocket-tts') {
      if (!POCKET_TTS_VOICE_RE.test(cur)) patch.voice = 'alba';
    }
    // Remote engine voices are free text — the sidecar decides. No default.
    onChange(patch);
  };

  // Resolve Cloud against this slot's saved provider even before the Cloud card
  // is selected. openai-compatible has no key-based availability entry and is
  // trusted by the server, while unknown providers retain the global status.
  const globalAvail = data?.tts?.available as EngineAvailability | undefined;
  let selectorAvailable = globalAvail;
  if (globalAvail) {
    const cloudByProv = globalAvail.cloudByProvider;
    if (cloudByProv && cloudProvider in cloudByProv) {
      selectorAvailable = { ...globalAvail, cloud: cloudByProv[cloudProvider] };
    } else if (cloudProvider === 'openai-compatible') {
      selectorAvailable = { ...globalAvail, cloud: true };
    }
  }

  const notice = (engine: string) => (
    <div className="mb-2.5 border border-[var(--danger)] px-3 py-2.5 text-[11px] leading-[1.6] text-[var(--danger)]">
      {unavailableNote(engine)}
    </div>
  );

  return (
    <>
      {/* Engine — radio-card grid, full width above the voice selector. */}
      <div className="field mb-4">
        <Label>Engine</Label>
        <EngineSelector
          value={value.engine}
          engineIds={ENGINE_IDS}
          available={selectorAvailable}
          onChange={selectEngine}
        />
        {engineHint && <div className="field-hint max-w-[70ch]">{engineHint}</div>}
      </div>

      {value.engine === 'piper' && (() => {
        const piperVoices: string[] = data?.tts?.piperVoices || [];
        const selected = value.voice || CB_DEFAULT_VOICE;
        // The default entry auditions with voice '' (the engine's built-in);
        // the sentinel only exists because an empty select value is invalid.
        const groups: VoicePickerGroup[] = [{
          voices: [
            { id: CB_DEFAULT_VOICE, label: 'Built-in default voice', previewVoice: '' },
            ...piperVoices.map(v => ({ id: v, label: v })),
            ...(value.voice && !piperVoices.includes(value.voice)
              ? [{ id: value.voice, label: value.voice, hint: 'missing' }]
              : []),
          ],
        }];
        return (
          <div className="field max-w-[360px]">
            <Label>Voice</Label>
            <VoicePicker
              value={selected}
              onChange={val => onChange({ voice: val === CB_DEFAULT_VOICE ? '' : val })}
              groups={groups}
              title="Piper voice"
              placeholder="Built-in default voice"
              preview={{ engine: 'piper', speed: previewSpeed, language: previewLanguage, adminFetch }}
            />
            <div className="field-hint">
              Piper is fast, local, and keyless. Drop a voice’s <code>.onnx</code> and its{' '}
              <code>.onnx.json</code> manifest into <code>state/voices/</code> on the host (the
              same files Home Assistant uses) and they’ll show up here. Leave on the built-in
              default if you don’t have any.
            </div>
          </div>
        );
      })()}

      {value.engine === 'kokoro' && (() => {
        const voice = value.voice || 'bf_isabella';
        const langPrefix = voice.charAt(0);
        const filtered = kokoroVoices.filter(v => v.startsWith(langPrefix));
        const fmt = (code: string) => {
          const [lg, name = ''] = code.split('_');
          const g = (lg?.[1] ?? '').toUpperCase();
          const n = name.charAt(0).toUpperCase() + name.slice(1);
          return `${n} (${g})`;
        };
        return (
          <div className="field max-w-[320px]">
            <Label>Kokoro voice</Label>
            <div className="field mt-3">
              <Label>Language</Label>
              <Select
                value={langPrefix}
                onValueChange={lang => {
                  const first = kokoroVoices.find(v => v.startsWith(lang));
                  if (first) onChange({ voice: first });
                }}
              >
                <SelectTrigger aria-label="Language"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {Object.entries(kokoroLanguages).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="field mt-3">
              <Label>Voice</Label>
              <VoicePicker
                value={voice}
                onChange={val => onChange({ voice: val })}
                groups={[{
                  voices: [
                    ...(!filtered.includes(voice) ? [{ id: voice, label: fmt(voice) }] : []),
                    ...filtered.map(v => ({ id: v, label: fmt(v) })),
                  ],
                }]}
                title="Kokoro voice"
                preview={{ engine: 'kokoro', speed: previewSpeed, language: previewLanguage, adminFetch }}
              />
            </div>
            <div className="field-hint">The kokoro-onnx voice id.</div>
          </div>
        );
      })()}

      {value.engine === 'chatterbox' && (() => {
        const cbVoices: string[] = data?.tts?.chatterboxVoices || [];
        // Shared voice folder (issue #213).
        const cbDir = 'state/voices/';
        const cbAvailable = data?.tts?.available?.chatterbox !== false;
        return (
          <div className="field max-w-[360px]">
            {!cbAvailable && notice('chatterbox')}
            <Label>Reference voice</Label>
            <VoicePicker
              value={value.voice || CB_DEFAULT_VOICE}
              onChange={val => onChange({ voice: val === CB_DEFAULT_VOICE ? '' : val })}
              groups={[{
                voices: [
                  { id: CB_DEFAULT_VOICE, label: 'Built-in default voice', previewVoice: '' },
                  ...cbVoices.map(v => ({ id: v, label: v })),
                  ...(value.voice && !cbVoices.includes(value.voice)
                    ? [{ id: value.voice, label: value.voice, hint: 'missing' }]
                    : []),
                ],
              }]}
              title="Chatterbox reference voice"
              placeholder="Built-in default voice"
              preview={{ engine: 'chatterbox', speed: previewSpeed, language: previewLanguage, adminFetch }}
            />
            <div className="field-hint">
              ~5s of clean speech is enough to clone a voice.{' '}
              <Link href="/admin/imaging?tab=voices" className="underline">Import one on the Voices page</Link>
              {' '}— or drop WAVs into <code>{cbDir}</code> on the host — and it’ll show up
              here. Chatterbox also voices paralinguistic tags ([laugh], [sigh], …) the
              DJ may insert.
            </div>
          </div>
        );
      })()}

      {value.engine === 'pocket-tts' && (() => {
        const ptAvailable = data?.tts?.available?.['pocket-tts'] !== false;
        const customVoices: string[] = data?.tts?.pocketTtsCustomVoices || [];
        const selected = value.voice || 'alba';
        const isBuiltin = pocketTtsVoices.some(v => v.id === selected);
        const isCustom = customVoices.includes(selected);
        // null/undefined = not yet known (sidecar still booting). Only false
        // means the engine confirmed it can't clone (issue #238).
        const ptCloning = data?.tts?.available?.pocketTtsCloning;
        const usingClone = isCustom || /\.wav$/i.test(selected);
        return (
          <div className="field max-w-[360px]">
            {!ptAvailable && notice('pocket-tts')}
            {ptAvailable && ptCloning === false && usingClone && (
              <div className="mb-2.5 border border-[var(--danger)] px-3 py-2.5 text-[11px] leading-[1.6] text-[var(--danger)]">
                Voice <strong>cloning is unavailable</strong> in this build, so this
                cloned voice won’t play; PocketTTS reverts to a built-in voice. The
                cloning model (<code>kyutai/pocket-tts</code>) is gated on Hugging Face:
                accept its terms, then set <code>HF_TOKEN</code> in your <code>.env</code>{' '}
                and restart <code>tts-heavy</code>. Built-in voices below work without a token.
              </div>
            )}
            <Label>PocketTTS voice</Label>
            <VoicePicker
              value={selected}
              onChange={val => onChange({ voice: val })}
              groups={[
                { label: 'Built-in', voices: pocketTtsVoices.map(v => ({ id: v.id, label: v.label })) },
                ...(customVoices.length > 0
                  ? [{
                    label: `Custom (cloned)${ptCloning === false ? ', cloning unavailable' : ''}`,
                    voices: customVoices.map(v => ({ id: v, label: v })),
                  }]
                  : []),
                // The slot references a voice that isn't currently present —
                // keep the value visible so a save round-trips without
                // rewriting, but flag it so the operator notices.
                ...(!isBuiltin && !isCustom && value.voice
                  ? [{
                    label: 'Unknown',
                    voices: [{ id: value.voice, label: value.voice, hint: 'missing' }],
                  }]
                  : []),
              ]}
              title="PocketTTS voice"
              preview={{ engine: 'pocket-tts', speed: previewSpeed, language: previewLanguage, adminFetch }}
            />
            <div className="field-hint">
              CPU-only, ~6× real-time. Built-in voices cover English, French, German,
              Italian, Spanish and Portuguese. To clone one,{' '}
              <Link href="/admin/imaging?tab=voices" className="underline">import a ~5s clip on the Voices page</Link>
              {' '}and it’ll appear under <em>Custom</em> (cloning needs <code>HF_TOKEN</code>;
              see above).
            </div>
          </div>
        );
      })()}

      {value.engine === 'remote' && (() => {
        const remoteAvail = data?.tts?.available?.remote;
        return (
          <div className="field max-w-[360px]">
            {remoteAvail === false && notice('remote')}
            <Label>Remote voice</Label>
            <Input
              aria-label="Remote voice"
              value={value.voice}
              maxLength={100}
              placeholder="Server-specific (id, filename, or VoiceDesign prompt)"
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ voice: e.target.value })}
            />
            <div className="field-hint">
              Free text forwarded to your self-hosted TTS endpoint: a voice
              id, a reference-wav filename, or a VoiceDesign prompt, whatever
              your sidecar accepts. Configure the endpoint URL in Settings
              &rarr; Voice.
            </div>
          </div>
        );
      })()}

      {value.engine === 'cloud' && (() => {
        const isCompat = cloudProvider === 'openai-compatible';
        const voice = value.voice.trim();
        const isPreset = isKnownCloudVoice(cloudProvider, discoveredVoices, voice);
        // A compat server that advertised nothing leaves us with no list to
        // show, so keep the plain text box it had before discovery existed.
        const hasList = discoveredVoices.length > 0 || !isCompat;
        const voiceGroups = buildCloudVoiceGroups(cloudProvider, discoveredVoices);
        return (
          <>
            {cloudIssue && (
              <div role="alert" className="mb-3.5 border border-[var(--danger)] px-3 py-2.5 text-[11px] leading-[1.6] text-[var(--danger)]">
                {cloudIssue}
              </div>
            )}
            <div className="stack-mobile grid grid-cols-[1fr_1fr] gap-4">
              <div className="field">
                <Label>Cloud provider</Label>
                <Seg
                  value={value.cloudProvider}
                  options={cloudProviders.map(id => ({
                    id,
                    label: id === 'fish-audio'
                      ? 'Fish Audio'
                      : id === 'elevenlabs'
                        ? 'ElevenLabs'
                        : id === 'openai'
                          ? 'OpenAI'
                          : 'OpenAI-compatible',
                  }))}
                  onChange={v => {
                    // Switching provider invalidates the old voice id.
                    // openai-compatible has no curated voices — leave the field
                    // blank so the operator picks from the new server's
                    // discovered list (or the server's default).
                    const next = CLOUD_VOICES[v as keyof typeof CLOUD_VOICES]?.[0]?.id || '';
                    onChange({ cloudProvider: v, voice: next });
                  }}
                />
                <div className="field-hint">
                  {isCompat
                    ? 'Uses the shared base URL + model from Settings.'
                    : 'Uses the shared API key + model from Settings.'}
                </div>
              </div>
              <div className="field">
                <Label>Cloud voice</Label>
                {!hasList ? (
                  <>
                    <Input
                      aria-label="Cloud voice"
                      value={value.voice}
                      maxLength={100}
                      placeholder="Server-specific (cloning ref or speaker id)"
                      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ voice: e.target.value })}
                    />
                    <div className="field-hint">
                      {voiceDiscovery.loading
                        ? 'Checking the server for a voice list…'
                        : <>Server-specific: Chatterbox cloning ref name, Qwen3
                            speaker id, etc. Leave blank to let the server pick.</>}
                    </div>
                  </>
                ) : (
                  <>
                    <VoicePicker
                      value={isPreset ? voice : CUSTOM_VOICE_ID}
                      onChange={val => {
                        // "Custom voice id…" clears the preset so isPreset flips
                        // false and the free-text input below appears for entry.
                        onChange({ voice: val === CUSTOM_VOICE_ID ? '' : val });
                      }}
                      groups={voiceGroups}
                      title="Cloud voice"
                      preview={{
                        engine: 'cloud',
                        cloudProvider,
                        speed: previewSpeed,
                        adminFetch,
                      }}
                    />
                    {!isPreset && (
                      <Input
                        // A blank compat voice is legitimate — the server picks
                        // its own default — so don't flag it red.
                        className={cn('mt-2', voice || isCompat ? 'border-ink' : 'border-[var(--danger)]')}
                        aria-label="Custom cloud voice id"
                        value={value.voice}
                        maxLength={100}
                        placeholder={isCompat ? 'Blank = server default' : 'Enter a custom voice id'}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ voice: e.target.value })}
                      />
                    )}
                    <div className="field-hint">
                      {discoveredVoices.length > 0
                        ? <>{discoveredVoices.length} voice{discoveredVoices.length === 1 ? '' : 's'} found
                            on your {isCompat ? 'server' : 'account'}. Choose <em>Custom voice id…</em> to
                            enter one that isn&apos;t listed.</>
                        : <>Pick a default voice, or choose <em>Custom voice id…</em> to enter your own
                            (e.g. an OpenAI voice name, ElevenLabs voice id, or Fish Audio reference id).</>}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* Audition this engine + voice before saving. */}
      <div className="mt-4">
        <VoicePreviewButton
          engine={value.engine}
          voice={value.voice}
          cloudProvider={value.cloudProvider}
          speed={previewSpeed}
          language={previewLanguage}
          adminFetch={adminFetch}
        />
        {previewHint && <div className="field-hint mt-1.5">{previewHint}</div>}
      </div>
    </>
  );
}
