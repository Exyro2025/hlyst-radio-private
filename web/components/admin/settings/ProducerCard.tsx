'use client';

import type { ChangeEvent } from 'react';
import { useEffect, useState } from 'react';
import { useModelDiscovery } from '@/hooks/useModelDiscovery';
import { notify, errorMessage } from '../../../lib/notify';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Card, Btn, Pill, Seg } from '../ui';
import { ProviderSelector } from '../llm/ProviderSelector';
import { ModelCombobox } from '../llm/ModelCombobox';
import { LLM_ENV_VARS, llmProviderLabel } from '../llm/providerMeta';
import {
  KeyStatus,
  KeyTestResult,
  SaveBar,
  KEY_HINTS,
  type SectionProps,
} from './shared';

const INLINE_KEY_PROVIDERS = ['openai-compatible', 'locca'];
const LOCCA_DEFAULT_BASE_URL = 'http://host.docker.internal:8080/v1';
type TestResult = { ok: boolean; message: string; latencyMs: number };

interface ProducerCardProps extends SectionProps {
  adminFetch: (path: string, init?: RequestInit) => Promise<Response>;
  refresh: () => void;
}

export function ProducerCard({
  data,
  form,
  setForm,
  busy,
  saveSettings,
  adminFetch,
  refresh,
  fieldErrors,
}: ProducerCardProps) {
  const producer = form.llm.producer;
  const [keyInput, setKeyInput] = useState('');
  const [keyTest, setKeyTest] = useState<TestResult | null>(null);
  const [keyTesting, setKeyTesting] = useState(false);
  const [compatKeyInput, setCompatKeyInput] = useState('');
  const [compatTest, setCompatTest] = useState<TestResult | null>(null);
  const [compatTesting, setCompatTesting] = useState(false);

  useEffect(() => {
    setKeyInput('');
    setKeyTest(null);
    setCompatKeyInput('');
    setCompatTest(null);
  }, [producer.provider]);

  const update = (patch: Partial<typeof producer>) => {
    setForm(f => ({
      ...f,
      llm: { ...f.llm, producer: { ...f.llm.producer, ...patch } },
    }));
  };

  const keyVar = LLM_ENV_VARS[producer.provider];
  const keySet = !!(keyVar && data.env?.[keyVar]);
  const baseUrl = producer.providerBaseUrls[producer.provider] ?? '';
  const testBaseUrl = baseUrl || (producer.provider === 'locca' ? LOCCA_DEFAULT_BASE_URL : '');
  const discoveryEnabled = producer.enabled && (
    producer.provider === 'ollama'
    || producer.provider === 'locca'
    || (producer.provider === 'openai-compatible' && !!baseUrl.trim())
    || producer.provider === 'openrouter'
    || (!!keyVar && keySet)
  );
  const discovery = useModelDiscovery({
    provider: producer.provider,
    baseUrl,
    ollamaUrl: producer.ollamaUrl,
    enabled: discoveryEnabled,
    adminFetch,
  });

  const saveSecret = async (envVar: string, value: string): Promise<boolean> => {
    if (!value.trim()) return true;
    try {
      const r = await adminFetch('/settings/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [envVar]: value.trim() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        notify.err(j.error || `Key save failed (${r.status})`);
        return false;
      }
      return true;
    } catch (err) {
      notify.err(errorMessage(err));
      return false;
    }
  };

  const testCloudKey = async () => {
    if (!keyVar || (!keyInput.trim() && !keySet)) return;
    setKeyTesting(true);
    setKeyTest(null);
    try {
      const r = await adminFetch('/settings/secrets/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keyVar, value: keyInput.trim() }),
      });
      const result = await r.json() as TestResult;
      setKeyTest(result);
      if (result.ok && keyInput.trim()) {
        const saved = await saveSecret(keyVar, keyInput);
        if (saved) {
          notify.ok('Key verified and saved');
          setKeyInput('');
          refresh();
        }
      }
    } catch (err) {
      setKeyTest({ ok: false, message: errorMessage(err), latencyMs: 0 });
    } finally {
      setKeyTesting(false);
    }
  };

  const testCompat = async () => {
    if (!testBaseUrl.trim()) {
      setCompatTest({ ok: false, message: 'Set a server base URL first', latencyMs: 0 });
      return;
    }
    if (!producer.model.trim()) {
      setCompatTest({ ok: false, message: 'Select a model first', latencyMs: 0 });
      return;
    }
    setCompatTesting(true);
    setCompatTest(null);
    try {
      const r = await adminFetch('/settings/llm/probe-compat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: compatKeyInput.trim(),
          baseUrl: testBaseUrl.trim(),
          model: producer.model.trim(),
        }),
      });
      setCompatTest(await r.json() as TestResult);
    } catch (err) {
      setCompatTest({ ok: false, message: errorMessage(err), latencyMs: 0 });
    } finally {
      setCompatTesting(false);
    }
  };

  const save = async () => {
    const payload = {
      enabled: producer.enabled,
      provider: producer.provider,
      model: producer.model,
      ollamaUrl: producer.ollamaUrl,
      numCtx: producer.numCtx,
      repeatPenalty: producer.repeatPenalty,
      discoverySteps: producer.discoverySteps,
      providerBaseUrls: producer.providerBaseUrls,
      reasoning: producer.reasoning,
      toolChoice: producer.toolChoice,
      ...(INLINE_KEY_PROVIDERS.includes(producer.provider) && compatKeyInput.trim()
        ? { apiKey: compatKeyInput.trim() }
        : {}),
    };
    const ok = await saveSettings({ llm: { producer: payload } });
    if (!ok) return;
    if (keyVar && keyInput.trim()) {
      const keySaved = await saveSecret(keyVar, keyInput);
      if (keySaved) {
        notify.ok('API key saved');
        setKeyInput('');
        refresh();
      }
    }
    if (INLINE_KEY_PROVIDERS.includes(producer.provider) && compatKeyInput.trim()) {
      setCompatKeyInput('');
    }
  };

  return (
    <>
      <Card
        title="Producer"
        sub="advanced · backstage decision model"
        right={<Pill tone="accent">preview</Pill>}
      >
        <div className="grid gap-[18px]">
          <div className="flex items-start gap-2.5 border border-[var(--accent)] bg-[var(--ink-softer)] p-3">
            <span className="mt-1 size-1.5 flex-none rounded-full bg-vermilion" />
            <div className="grid min-w-0 gap-0.5">
              <span className="text-[11px] font-bold tracking-[0.12em] text-vermilion uppercase">
                Rehearsal routing only
              </span>
              <span className="text-[14px] leading-[1.5] text-muted">
                This connection is available to Producer evaluations, but no live
                broadcast call is redirected yet. Enabling it cannot change what
                goes on air in this preview stage.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
            <div>
              <div className="text-[13px] font-bold">Use a dedicated Producer LLM</div>
              <div className="mt-0.5 max-w-[500px] text-[14px] leading-[1.5] text-muted">
                Keeps backstage tool calls and structured decisions away from the
                Persona model. If this model is unavailable, a Producer evaluation
                retries once on the primary model.
              </div>
            </div>
            <Seg
              accent
              value={producer.enabled ? 'on' : 'off'}
              options={[{ id: 'off', label: 'Off' }, { id: 'on', label: 'On' }]}
              onChange={value => update({ enabled: value === 'on' })}
            />
          </div>

          {producer.enabled && (
            <>
              <div className="field">
                <Label>Producer provider</Label>
                <ProviderSelector
                  value={producer.provider}
                  providerIds={data.llm?.providers || ['ollama']}
                  env={data.env}
                  onChange={provider => update({ provider })}
                />
              </div>

              {producer.provider === 'ollama' && (
                <>
                  <div className="field">
                    <Label>Ollama server URL</Label>
                    <Input
                      value={producer.ollamaUrl}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => update({ ollamaUrl: event.target.value })}
                      placeholder="http://producer-ollama:11434"
                      className="max-w-[420px]"
                    />
                    <div className="field-hint">Must be reachable from the controller container.</div>
                  </div>
                  <div className="field">
                    <Label>Context window (num_ctx)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={1024}
                      value={producer.numCtx}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => update({ numCtx: Number(event.target.value) })}
                      className="max-w-[200px]"
                    />
                  </div>
                </>
              )}

              {(producer.provider === 'openai-compatible' || producer.provider === 'locca') && (
                <div className="field">
                  <Label>Server base URL</Label>
                  <Input
                    value={producer.providerBaseUrls[producer.provider] ?? ''}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => update({
                      providerBaseUrls: {
                        ...producer.providerBaseUrls,
                        [producer.provider]: event.target.value,
                      },
                    })}
                    placeholder={producer.provider === 'locca'
                      ? 'http://host.docker.internal:8080/v1'
                      : 'http://producer-llama-cpp:8080/v1'}
                    className="max-w-[420px]"
                  />
                  <div className="field-hint">
                    Include <code>/v1</code>. Docker service names are preferable
                    when both containers share a network.
                  </div>
                </div>
              )}

              {INLINE_KEY_PROVIDERS.includes(producer.provider) && (
                <>
                  <div className="field">
                    <Label>Bearer token</Label>
                    <div className="flex flex-wrap items-stretch gap-2 sm:flex-nowrap">
                      <Input
                        type="password"
                        autoComplete="off"
                        value={compatKeyInput}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => setCompatKeyInput(event.target.value)}
                        placeholder={(data.values?.llm as { keys?: Record<string, unknown> })?.keys?.[producer.provider] === 'set'
                          ? '•••••• (on file)'
                          : 'Bearer token (optional)'}
                        className="max-w-[360px]"
                      />
                      <Btn onClick={testCompat} disabled={compatTesting || !testBaseUrl.trim()}>
                        {compatTesting ? 'Testing…' : 'Test connection'}
                      </Btn>
                    </div>
                    <div className="field-hint">
                      Shared with other LLM legs using this provider; leave blank
                      when llama.cpp has no API key.
                    </div>
                  </div>
                  {compatTest && <KeyTestResult result={compatTest} />}
                </>
              )}

              {keyVar && (
                <>
                  <div className="field">
                    <Label>{llmProviderLabel(producer.provider)} API key</Label>
                    <div className="flex flex-wrap items-stretch gap-2 sm:flex-nowrap">
                      <Input
                        type="password"
                        autoComplete="off"
                        value={keyInput}
                        placeholder={keySet ? '•••••• (on file)' : (KEY_HINTS[keyVar] ?? '')}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyInput(event.target.value)}
                        className="max-w-[360px]"
                      />
                      <Btn onClick={testCloudKey} disabled={keyTesting || (!keyInput.trim() && !keySet)}>
                        {keyTesting ? 'Testing…' : 'Test key'}
                      </Btn>
                    </div>
                  </div>
                  {keyTest && <KeyTestResult result={keyTest} />}
                  <KeyStatus envVar={keyVar} present={keySet} />
                </>
              )}

              <div className="field">
                <Label>Producer model</Label>
                <div className="flex flex-wrap items-stretch gap-2 sm:flex-nowrap">
                  {discovery.models.length > 0 ? (
                    <ModelCombobox
                      models={discovery.models}
                      value={producer.model}
                      onChange={model => update({ model })}
                      placeholder="Select a model"
                    />
                  ) : (
                    <Input
                      value={producer.model}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => update({ model: event.target.value })}
                      disabled={!discoveryEnabled && producer.provider !== 'ollama'}
                      placeholder={!discoveryEnabled ? 'Complete the connection above first' : 'model id'}
                      className="max-w-[420px]"
                    />
                  )}
                  {discovery.loading
                    ? <span className="animate-pulse text-[11px] whitespace-nowrap text-muted">discovering…</span>
                    : discoveryEnabled && <Btn onClick={discovery.refresh} title="Refresh model list">↻</Btn>}
                </div>
                <div className="field-hint">
                  {discovery.models.length > 0
                    ? `${discovery.models.length} model${discovery.models.length === 1 ? '' : 's'} discovered.`
                    : discovery.error
                      ? `Discovery failed: ${discovery.error}. Type the model ID manually.`
                      : 'The controller reads the model list directly from this connection.'}
                </div>
              </div>

              {(producer.provider === 'openai-compatible' || producer.provider === 'locca') && (
                <div className="field">
                  <Label>Repetition penalty (repeat_penalty)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={2}
                    step={0.05}
                    value={producer.repeatPenalty}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => update({ repeatPenalty: Number(event.target.value) })}
                    className="max-w-[200px]"
                  />
                </div>
              )}

              {producer.provider === 'openai-compatible' && (
                <div className="field">
                  <Label>Forced tool calls</Label>
                  <Seg
                    accent
                    value={producer.toolChoice === 'auto' ? 'auto' : 'required'}
                    options={[{ id: 'required', label: 'Required' }, { id: 'auto', label: 'Auto' }]}
                    onChange={toolChoice => update({ toolChoice })}
                  />
                  <div className="field-hint">
                    Required is the reliable default for local tool-focused models.
                  </div>
                </div>
              )}

              <div className="field">
                <Label>Discovery rounds</Label>
                <Input
                  type="number"
                  min={0}
                  max={5}
                  step={1}
                  value={producer.discoverySteps}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => update({ discoverySteps: Number(event.target.value) })}
                  className="max-w-[200px]"
                />
                <div className="field-hint">
                  <strong>0 = auto.</strong> Producer prompts use the lower budget
                  of this model and the primary safety fallback.
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
                <div>
                  <div className="text-[13px] font-bold">Producer chain-of-thought</div>
                  <div className="field-hint mt-1">Off is recommended for structured tool work.</div>
                </div>
                <Seg
                  accent
                  value={producer.reasoning ? 'on' : 'off'}
                  options={[{ id: 'off', label: 'Off' }, { id: 'on', label: 'On' }]}
                  onChange={value => update({ reasoning: value === 'on' })}
                />
              </div>
            </>
          )}
        </div>
      </Card>

      <SaveBar
        note={producer.enabled
          ? `Producer preview: ${producer.provider}:${producer.model || '(model not set)'}. Live broadcast routing remains unchanged.`
          : 'Dedicated Producer routing is off; evaluations inherit the primary model.'}
        busy={busy}
        onSave={save}
        saveLabel="Save Producer"
        errors={fieldErrors}
        ownedKeys={['llm.producer']}
      />
    </>
  );
}
