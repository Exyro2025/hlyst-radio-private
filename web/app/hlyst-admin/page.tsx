'use client';

import { useEffect, useState, useRef } from 'react';
import { parseBlob } from 'music-metadata';
import { upload } from '@vercel/blob/client';

const GOLD = '#c9a44c';
const IVORY = '#f5f0e8';
const BG = '#0a0a0a';

interface MessageRow {
  id: number;
  listener_name: string | null;
  message: string;
  status: string;
  created_at: string;
}

interface VoiceNoteRow {
  id: number;
  listener_name: string | null;
  audio_url: string;
  status: string;
  created_at: string;
}

interface PersonaRow {
  id: string;
  name: string;
  tagline: string;
  soul: string;
  frequency: string;
  script_length: string;
  dj_mode: boolean;
  humour: number;
  local_colour: number;
  warmth: number;
  language: string;
  avatar: string;
  tts_engine: string;
  tts_voice_id: string;
  tts_gain_db: number;
  tts_speed: number;
  is_imaging: boolean;
  enabled: boolean;
}

const FREQUENCIES = ['silent', 'quiet', 'moderate', 'chatty', 'aggressive'];
const SCRIPT_LENGTHS = ['one-liner', 'concise', 'extended', 'storyteller'];

const fieldStyle: React.CSSProperties = {
  width: '100%', background: '#111', border: '1px solid #222', color: IVORY,
  padding: '0.6rem', borderRadius: 4, fontSize: '0.9rem',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.75rem', color: '#999', marginBottom: '0.35rem', marginTop: '1rem',
};

export default function HlystAdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [voiceNotes, setVoiceNotes] = useState<VoiceNoteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'talkwave' | 'personas' | 'health' | 'breaks' | 'vm' | 'production'>('talkwave');

  const [personas, setPersonas] = useState<PersonaRow[]>([]);
  const [personasLoading, setPersonasLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PersonaRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [previewBreakType, setPreviewBreakType] = useState('ad_lib');
  const [previewText, setPreviewText] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewAudioUrl, setPreviewAudioUrl] = useState('');
  const [previewAudioError, setPreviewAudioError] = useState('');

  const [breaksLog, setBreaksLog] = useState<any[]>([]);
  const [breaksLoading, setBreaksLoading] = useState(false);
  const [tickResult, setTickResult] = useState<any>(null);
  const [tickLoading, setTickLoading] = useState(false);
  const [tickLog, setTickLog] = useState<any[]>([]);

  const [vmItems, setVmItems] = useState<any[]>([]);
  const [vmLoading, setVmLoading] = useState(false);
  const [vmGenerateType, setVmGenerateType] = useState('station_id');
  const [vmGenerating, setVmGenerating] = useState(false);
  const [vmError, setVmError] = useState('');

  const [prodItems, setProdItems] = useState<any[]>([]);
  const [prodLoading, setProdLoading] = useState(false);
  const [prodFile, setProdFile] = useState<File | null>(null);
  const [prodTitle, setProdTitle] = useState('');
  const [prodArtist, setProdArtist] = useState('HLYST');
  const [prodComposer, setProdComposer] = useState('');
  const [prodGenre, setProdGenre] = useState('');
  const [prodDuration, setProdDuration] = useState<number | null>(null);
  const [prodFormat, setProdFormat] = useState('');
  const [prodClassifications, setProdClassifications] = useState<string[]>([]);
  const [prodParsing, setProdParsing] = useState(false);
  const [prodUploading, setProdUploading] = useState(false);
  const [prodError, setProdError] = useState('');
  const prodFileInputRef = useRef<HTMLInputElement>(null);

  const [health, setHealth] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch('/api/hlyst-admin/data');
    if (res.status === 401) {
      setAuthed(false);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setMessages(data.messages || []);
    setVoiceNotes(data.voiceNotes || []);
    setAuthed(true);
    setLoading(false);
  };

  const fetchPersonas = async () => {
    setPersonasLoading(true);
    const res = await fetch('/api/hlyst-admin/personas');
    if (res.ok) {
      const data = await res.json();
      setPersonas(data.personas || []);
    }
    setPersonasLoading(false);
  };

  const fetchHealth = async () => {
    setHealthLoading(true);
    const res = await fetch('/api/hlyst-admin/health');
    if (res.ok) {
      setHealth(await res.json());
    }
    setHealthLoading(false);
  };

  const fetchBreaksLog = async () => {
    setBreaksLoading(true);
    const res = await fetch('/api/hlyst-admin/dj-breaks');
    if (res.ok) {
      const data = await res.json();
      setBreaksLog(data.breaks || []);
    }
    setBreaksLoading(false);
  };

  const fetchTickLog = async () => {
    const res = await fetch('/api/hlyst-admin/engine-tick-log');
    if (res.ok) {
      const data = await res.json();
      setTickLog(data.ticks || []);
    }
  };

  const fetchVmItems = async () => {
    setVmLoading(true);
    const res = await fetch('/api/hlyst-admin/vm-imaging');
    if (res.ok) {
      const data = await res.json();
      setVmItems(data.items || []);
    }
    setVmLoading(false);
  };

  const generateVmImaging = async () => {
    setVmGenerating(true);
    setVmError('');
    try {
      const res = await fetch('/api/hlyst-admin/vm-imaging/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagingType: vmGenerateType }),
      });
      const body = await res.json();
      if (!res.ok) {
        setVmError(body.error || 'Generation failed.');
      } else {
        fetchVmItems();
      }
    } catch {
      setVmError('Could not reach the generation endpoint.');
    }
    setVmGenerating(false);
  };

  const updateVmStatus = async (id: number, status: string) => {
    await fetch('/api/hlyst-admin/vm-imaging/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    fetchVmItems();
  };

  const fetchProdItems = async () => {
    setProdLoading(true);
    const res = await fetch('/api/hlyst-admin/production-music');
    if (res.ok) {
      const data = await res.json();
      setProdItems(data.items || []);
    }
    setProdLoading(false);
  };

  const handleProdFileSelect = async (file: File) => {
    setProdFile(file);
    setProdError('');
    setProdParsing(true);
    try {
      const metadata = await parseBlob(file);
      setProdTitle(metadata.common.title || file.name.replace(/\.[^.]+$/, ''));
      setProdComposer(metadata.common.composer?.join(', ') || '');
      setProdGenre(metadata.common.genre?.join(', ') || '');
      setProdDuration(metadata.format.duration ? Math.round(metadata.format.duration) : null);
      setProdFormat(metadata.format.container || file.type.split('/')[1] || '');
    } catch {
      setProdTitle(file.name.replace(/\.[^.]+$/, ''));
    }
    setProdParsing(false);
  };

  const toggleProdClassification = (c: string) => {
    setProdClassifications((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const uploadProdTrack = async () => {
    if (!prodFile || !prodTitle) return;
    setProdUploading(true);
    setProdError('');
    try {
      const blob = await upload(prodFile.name, prodFile, {
        access: 'public',
        handleUploadUrl: '/api/hlyst-admin/production-music/upload-token',
      });

      const res = await fetch('/api/hlyst-admin/production-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: prodTitle,
          artist: prodArtist,
          composer: prodComposer,
          genre: prodGenre,
          durationSeconds: prodDuration,
          fileFormat: prodFormat,
          fileSizeBytes: prodFile.size,
          audioUrl: blob.url,
          classifications: prodClassifications,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setProdError(body.error || 'Save failed.');
      } else {
        setProdFile(null);
        setProdTitle('');
        setProdArtist('HLYST');
        setProdComposer('');
        setProdGenre('');
        setProdDuration(null);
        setProdFormat('');
        setProdClassifications([]);
        if (prodFileInputRef.current) prodFileInputRef.current.value = '';
        fetchProdItems();
      }
    } catch (e) {
      setProdError(e instanceof Error ? e.message : 'Upload failed.');
    }
    setProdUploading(false);
  };

  const runEngineTick = async () => {
    setTickLoading(true);
    setTickResult(null);
    try {
      const res = await fetch('/api/hlyst-admin/engine-tick', { method: 'POST' });
      setTickResult(await res.json());
    } catch {
      setTickResult({ error: 'Could not reach the engine-tick endpoint.' });
    }
    setTickLoading(false);
    fetchBreaksLog();
    fetchTickLog();
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (tab === 'personas' && authed && personas.length === 0) {
      fetchPersonas();
    }
    if (tab === 'health' && authed) {
      fetchHealth();
    }
    if (tab === 'breaks' && authed) {
      fetchBreaksLog();
      fetchTickLog();
    }
    if (tab === 'vm' && authed) {
      fetchVmItems();
    }
    if (tab === 'production' && authed) {
      fetchProdItems();
    }
  }, [tab, authed]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const res = await fetch('/api/hlyst-admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      fetchData();
    } else {
      setLoginError('Invalid credentials.');
    }
  };

  const handleLogout = async () => {
    await fetch('/api/hlyst-admin/logout', { method: 'POST' });
    setAuthed(false);
  };

  const updateStatus = async (table: 'messages' | 'voice_notes', id: number, status: string) => {
    await fetch('/api/hlyst-admin/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, id, status }),
    });
    fetchData();
  };

  const selectPersona = (p: PersonaRow) => {
    setSelectedId(p.id);
    setDraft({ ...p });
    setSaveError('');
    setPreviewText('');
    setPreviewError('');
    setPreviewAudioUrl('');
    setPreviewAudioError('');
  };

  const generatePreview = async () => {
    if (!draft) return;
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewText('');
    setPreviewAudioUrl('');
    setPreviewAudioError('');
    try {
      const res = await fetch('/api/hlyst-admin/generate-break', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId: draft.id, breakType: previewBreakType }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPreviewError(body.error || 'Generation failed.');
      } else {
        setPreviewText(body.text);
        if (body.audioUrl) setPreviewAudioUrl(body.audioUrl);
        if (body.audioError) setPreviewAudioError(body.audioError);
      }
    } catch {
      setPreviewError('Could not reach the generation endpoint.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const savePersona = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError('');
    const res = await fetch('/api/hlyst-admin/personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: draft.id,
        name: draft.name,
        tagline: draft.tagline,
        soul: draft.soul,
        frequency: draft.frequency,
        scriptLength: draft.script_length,
        djMode: draft.dj_mode,
        humour: draft.humour,
        localColour: draft.local_colour,
        warmth: draft.warmth,
        language: draft.language,
        avatar: draft.avatar,
        ttsEngine: draft.tts_engine,
        ttsVoiceId: draft.tts_voice_id,
        ttsGainDb: draft.tts_gain_db,
        ttsSpeed: draft.tts_speed,
        isImaging: draft.is_imaging,
        enabled: draft.enabled,
      }),
    });
    if (res.ok) {
      await fetchPersonas();
    } else {
      const body = await res.json().catch(() => ({}));
      setSaveError(body.error || 'Save failed.');
    }
    setSaving(false);
  };

  if (authed === null) {
    return <div style={{ background: BG, minHeight: '100vh', color: IVORY, padding: '3rem' }}>Loading…</div>;
  }

  if (!authed) {
    return (
      <div style={{ background: BG, minHeight: '100vh', color: IVORY, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <form onSubmit={handleLogin} style={{ width: 320 }}>
          <h1 style={{ color: GOLD, fontSize: '1.3rem', marginBottom: '1.5rem' }}>HLYST Control Room</h1>
          <input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ width: '100%', background: '#111', border: '1px solid #222', color: IVORY, padding: '0.65rem', borderRadius: 4, marginBottom: '0.75rem' }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', background: '#111', border: '1px solid #222', color: IVORY, padding: '0.65rem', borderRadius: 4, marginBottom: '1rem' }}
          />
          {loginError && <p style={{ color: '#e88', fontSize: '0.85rem', marginBottom: '1rem' }}>{loginError}</p>}
          <button type="submit" style={{
            width: '100%', border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent',
            padding: '0.65rem', borderRadius: 999, cursor: 'pointer',
          }}>
            Sign In
          </button>
        </form>
      </div>
    );
  }

  const StatusButtons = ({ table, id, status }: { table: 'messages' | 'voice_notes'; id: number; status: string }) => (
    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
      {['approved', 'rejected', 'archived'].map((s) => (
        <button
          key={s}
          onClick={() => updateStatus(table, id, s)}
          disabled={status === s}
          style={{
            fontSize: '0.75rem', padding: '0.3rem 0.7rem', borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${status === s ? GOLD : '#333'}`,
            color: status === s ? GOLD : '#999',
            background: 'transparent', opacity: status === s ? 1 : 0.8,
          }}
        >
          {s}
        </button>
      ))}
    </div>
  );

  const TabButton = ({ id, label }: { id: 'talkwave' | 'personas' | 'health' | 'breaks' | 'vm' | 'production'; label: string }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', paddingBottom: '0.5rem',
        color: tab === id ? GOLD : '#888',
        borderBottom: tab === id ? `2px solid ${GOLD}` : '2px solid transparent',
        fontSize: '0.95rem', marginRight: '1.5rem',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ background: BG, minHeight: '100vh', color: IVORY, padding: '3rem 2rem', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ color: GOLD, fontSize: '1.6rem', margin: 0 }}>HLYST Control Room</h1>
        <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>
          Sign out
        </button>
      </div>

      <div style={{ borderBottom: '1px solid #222', marginBottom: '2rem' }}>
        <TabButton id="talkwave" label="Talk Wave" />
        <TabButton id="personas" label="DJ Personas" />
        <TabButton id="health" label="Engine Health" />
        <TabButton id="breaks" label="DJ Breaks" />
        <TabButton id="vm" label="Station Imaging" />
        <TabButton id="production" label="Production Music" />
      </div>

      {tab === 'talkwave' && (
        <>
          {loading && <p style={{ color: '#888' }}>Loading…</p>}

          <section style={{ marginBottom: '3rem' }}>
            <h2 style={{ color: GOLD, fontSize: '1.1rem', marginBottom: '1rem' }}>Messages ({messages.length})</h2>
            {messages.length === 0 && <p style={{ color: '#666' }}>No messages yet.</p>}
            {messages.map((m) => (
              <div key={m.id} style={{ border: '1px solid #222', padding: '1rem', marginBottom: '0.75rem', borderRadius: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>
                  <span>{m.listener_name || 'Anonymous'}</span>
                  <span>{new Date(m.created_at).toLocaleString()} · {m.status}</span>
                </div>
                <p style={{ margin: 0, fontSize: '0.95rem' }}>{m.message}</p>
                <StatusButtons table="messages" id={m.id} status={m.status} />
              </div>
            ))}
          </section>

          <section>
            <h2 style={{ color: GOLD, fontSize: '1.1rem', marginBottom: '1rem' }}>Voice Notes ({voiceNotes.length})</h2>
            {voiceNotes.length === 0 && <p style={{ color: '#666' }}>No voice notes yet.</p>}
            {voiceNotes.map((v) => (
              <div key={v.id} style={{ border: '1px solid #222', padding: '1rem', marginBottom: '0.75rem', borderRadius: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>
                  <span>{v.listener_name || 'Anonymous'}</span>
                  <span>{new Date(v.created_at).toLocaleString()} · {v.status}</span>
                </div>
                <audio controls src={v.audio_url} style={{ width: '100%' }} />
                <StatusButtons table="voice_notes" id={v.id} status={v.status} />
              </div>
            ))}
          </section>
        </>
      )}

      {tab === 'personas' && (
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>
          <div style={{ width: 260, flexShrink: 0 }}>
            {personasLoading && <p style={{ color: '#888' }}>Loading…</p>}
            {!personasLoading && personas.length === 0 && (
              <p style={{ color: '#666', fontSize: '0.85rem' }}>
                No personas found — the database table may not be set up yet.
              </p>
            )}
            {personas.map((p) => (
              <button
                key={p.id}
                onClick={() => selectPersona(p)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: 'none',
                  border: '1px solid #222', borderRadius: 4, padding: '0.65rem 0.8rem',
                  marginBottom: '0.4rem', cursor: 'pointer',
                  color: selectedId === p.id ? GOLD : IVORY,
                  borderColor: selectedId === p.id ? GOLD : '#222',
                }}
              >
                <div style={{ fontSize: '0.9rem' }}>
                  {p.name} {p.is_imaging && <span style={{ color: '#888', fontSize: '0.7rem' }}>· imaging</span>}
                  {!p.enabled && <span style={{ color: '#e88', fontSize: '0.7rem' }}> · disabled</span>}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#888' }}>{p.tagline}</div>
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }}>
            {!draft && <p style={{ color: '#666' }}>Select a persona to edit.</p>}
            {draft && (
              <div>
                <h2 style={{ color: GOLD, fontSize: '1.2rem', margin: 0 }}>{draft.name}</h2>

                <label style={labelStyle}>Name</label>
                <input style={fieldStyle} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />

                <label style={labelStyle}>Tagline / role</label>
                <input style={fieldStyle} value={draft.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} />

                <label style={labelStyle}>Soul (personality — what the engine reads on every call)</label>
                <textarea style={{ ...fieldStyle, minHeight: 90, resize: 'vertical' }} value={draft.soul} onChange={(e) => setDraft({ ...draft, soul: e.target.value })} />

                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Talk frequency</label>
                    <select style={fieldStyle} value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value })}>
                      {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Script length</label>
                    <select style={fieldStyle} value={draft.script_length} onChange={(e) => setDraft({ ...draft, script_length: e.target.value })}>
                      {SCRIPT_LENGTHS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <label style={labelStyle}>
                  <input type="checkbox" checked={draft.dj_mode} onChange={(e) => setDraft({ ...draft, dj_mode: e.target.checked })} style={{ marginRight: '0.5rem' }} />
                  DJ mode (announces tracks, not just idents/banter)
                </label>

                {(['humour', 'local_colour', 'warmth'] as const).map((key) => (
                  <div key={key}>
                    <label style={labelStyle}>{key.replace('_', ' ')} ({draft[key]}/10)</label>
                    <input
                      type="range" min={0} max={10} value={draft[key]}
                      onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
                      style={{ width: '100%' }}
                    />
                  </div>
                ))}

                <label style={labelStyle}>Language (blank = English default)</label>
                <input style={fieldStyle} value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} />

                <label style={labelStyle}>ElevenLabs Voice ID</label>
                <input style={fieldStyle} value={draft.tts_voice_id} placeholder="Not set yet" onChange={(e) => setDraft({ ...draft, tts_voice_id: e.target.value })} />

                <label style={labelStyle}>
                  <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} style={{ marginRight: '0.5rem' }} />
                  Enabled
                </label>

                {draft.is_imaging && (
                  <p style={{ color: '#888', fontSize: '0.8rem', marginTop: '1rem' }}>
                    Imaging persona — no regular schedule, used for IDs/transitions/promos only.
                  </p>
                )}

                {saveError && <p style={{ color: '#e88', fontSize: '0.85rem', marginTop: '1rem' }}>{saveError}</p>}

                <button
                  onClick={savePersona}
                  disabled={saving}
                  style={{
                    marginTop: '1.5rem', border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent',
                    padding: '0.6rem 1.5rem', borderRadius: 999, cursor: 'pointer',
                  }}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>

                <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #222' }}>
                  <label style={labelStyle}>Preview — generate a test line (not sent to air, not saved anywhere)</label>
                  <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.4rem' }}>
                    <select style={{ ...fieldStyle, flex: 1 }} value={previewBreakType} onChange={(e) => setPreviewBreakType(e.target.value)}>
                      <option value="show_open">Show open</option>
                      <option value="back_announce">Back-announce</option>
                      <option value="station_id">Station ID</option>
                      <option value="ad_lib">Ad-lib</option>
                    </select>
                    <button
                      onClick={generatePreview}
                      disabled={previewLoading}
                      style={{
                        border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent',
                        padding: '0.6rem 1.2rem', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      {previewLoading ? 'Generating…' : 'Generate'}
                    </button>
                  </div>
                  {previewError && <p style={{ color: '#e88', fontSize: '0.85rem', marginTop: '0.75rem' }}>{previewError}</p>}
                  {previewText && (
                    <div style={{ marginTop: '0.75rem', padding: '0.9rem 1rem', background: '#111', border: '1px solid #222', borderRadius: 6 }}>
                      <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.6, fontStyle: 'italic' }}>{previewText}</p>
                      {previewAudioUrl && (
                        <audio controls src={previewAudioUrl} style={{ width: '100%', marginTop: '0.75rem' }} />
                      )}
                      {previewAudioError && (
                        <p style={{ color: '#c9944c', fontSize: '0.8rem', marginTop: '0.6rem' }}>Audio not rendered: {previewAudioError}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'health' && (
        <div>
          {healthLoading && <p style={{ color: '#888' }}>Checking…</p>}
          {!healthLoading && !health && <p style={{ color: '#e88' }}>Couldn't reach the health check.</p>}
          {health && (
            <div>
              <p style={{ color: '#666', fontSize: '0.8rem', marginBottom: '1.5rem' }}>
                Checked {new Date(health.checkedAt).toLocaleTimeString()}. Each row is either real
                and working, or honestly reported as not set up yet — nothing here is a guess.
              </p>

              <HealthRow label="ElevenLabs API key" ok={health.elevenLabsConfigured}
                detail={health.elevenLabsConfigured ? 'Configured' : 'ELEVENLABS_API_KEY not set'} />
              <HealthRow label="LLM (text generation)" ok={health.llmConfigured}
                detail={health.llmConfigured ? 'Configured' : 'ANTHROPIC_API_KEY / OPENAI_API_KEY not set'} />
              <HealthRow label="Live365 connection" ok={health.live365Configured}
                detail={health.live365Configured ? 'Configured' : 'LIVE365_STATION_ID / LIVE365_STREAM_URL not set'} />
              <HealthRow label="Talk Wave engine secret" ok={health.talkWaveEngineSecretConfigured}
                detail={health.talkWaveEngineSecretConfigured ? 'Configured' : 'TALKWAVE_ENGINE_SECRET not set'} />
              <HealthRow label="Engine cron secret" ok={health.engineCronSecretConfigured}
                detail={health.engineCronSecretConfigured ? 'Configured' : 'HLYST_ENGINE_CRON_SECRET not set'} />
              <HealthRow label="Scheduler (GitHub Actions tick)" ok={!!health.lastTick && health.lastTick.minutesAgo < 15}
                detail={
                  health.lastTick
                    ? `Last ran ${health.lastTick.minutesAgo} min ago${health.lastTick.skippedDuplicate ? ' (duplicate, skipped)' : health.lastTick.shouldSpeak ? ` — ${health.lastTick.breakType}` : ' — no break needed'}`
                    : 'No tick recorded yet — scheduler may not be running'
                } />
              <HealthRow label="Personas table" ok={health.personasTable.ok}
                detail={health.personasTable.ok ? `${health.personasTable.count} personas` : 'Not created yet'} />
              <HealthRow label="  — imaging persona (VM)" ok={health.imagingPersonaCount.ok && health.imagingPersonaCount.count === 1}
                detail={health.imagingPersonaCount.ok ? `${health.imagingPersonaCount.count} found (should be 1)` :
