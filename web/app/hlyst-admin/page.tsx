'use client';

import { useEffect, useState, useRef } from 'react';
import { parseBlob } from 'music-metadata';

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
  category?: string | null;
  transcript?: string | null;
  transcript_status?: string | null;
  safety_reason?: string | null;
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
  const [tab, setTab] = useState<'talkwave' | 'personas' | 'health' | 'breaks' | 'vm' | 'production' | 'artist'>('talkwave');

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

  const [artistItems, setArtistItems] = useState<any[]>([]);
  const [artistLoading, setArtistLoading] = useState(false);
  const [artistFile, setArtistFile] = useState<File | null>(null);
  const [artistTitle, setArtistTitle] = useState('');
  const [artistArtist, setArtistArtist] = useState('');
  const [artistComposer, setArtistComposer] = useState('');
  const [artistGenre, setArtistGenre] = useState('');
  const [artistDuration, setArtistDuration] = useState<number | null>(null);
  const [artistFormat, setArtistFormat] = useState('');
  const [artistReleaseStatus, setArtistReleaseStatus] = useState('CURRENT');
  const [artistReleaseDate, setArtistReleaseDate] = useState('');
  const [artistParsing, setArtistParsing] = useState(false);
  const [artistUploading, setArtistUploading] = useState(false);
  const [artistError, setArtistError] = useState('');
  const artistFileInputRef = useRef<HTMLInputElement>(null);
  const [artistArtworkFile, setArtistArtworkFile] = useState<File | null>(null);
  const [artistArtworkPreview, setArtistArtworkPreview] = useState('');
  const artistArtworkInputRef = useRef<HTMLInputElement>(null);

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

  const deleteProdItem = async (id: number) => {
    if (!confirm('Delete this production track? This removes the file permanently, not just from the list.')) return;
    await fetch('/api/hlyst-admin/production-music', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    fetchProdItems();
  };

  const fetchArtistItems = async () => {
    setArtistLoading(true);
    const res = await fetch('/api/hlyst-admin/artist-music');
    if (res.ok) {
      const data = await res.json();
      setArtistItems(data.items || []);
    }
    setArtistLoading(false);
  };

  const handleArtistFileSelect = async (file: File) => {
    setArtistFile(file);
    setArtistError('');
    setArtistParsing(true);
    try {
      const metadata = await parseBlob(file);
      setArtistTitle(metadata.common.title || file.name.replace(/\.[^.]+$/, ''));
      setArtistArtist(metadata.common.artist || '');
      setArtistComposer(metadata.common.composer?.join(', ') || '');
      setArtistGenre(metadata.common.genre?.join(', ') || '');
      setArtistDuration(metadata.format.duration ? Math.round(metadata.format.duration) : null);
      setArtistFormat(metadata.format.container || file.type.split('/')[1] || '');
    } catch {
      setArtistTitle(file.name.replace(/\.[^.]+$/, ''));
    }
    setArtistParsing(false);
  };

  const uploadArtistTrack = async () => {
    if (!artistFile || !artistTitle || !artistArtist) return;
    setArtistUploading(true);
    setArtistError('');
    try {
      let artworkUrl: string | null = null;
      if (artistArtworkFile) {
        const artworkFormData = new FormData();
        artworkFormData.append('file', artistArtworkFile);
        const artworkRes = await fetch('/api/hlyst-admin/artist-music/artwork-upload', {
          method: 'POST',
          body: artworkFormData,
        });
        const artworkBody = await artworkRes.json();
        if (!artworkRes.ok) {
          setArtistError(artworkBody.error || 'Artwork upload failed.');
          setArtistUploading(false);
          return;
        }
        artworkUrl = artworkBody.url;
      }

      const artistUploadForm = new FormData();
      artistUploadForm.append('file', artistFile);
      const artistUploadRes = await fetch('/api/hlyst-admin/artist-music/upload', {
        method: 'POST',
        body: artistUploadForm,
      });
      const artistUploadBody = await artistUploadRes.json();
      if (!artistUploadRes.ok) {
        setArtistError(artistUploadBody.error || 'Upload failed.');
        setArtistUploading(false);
        return;
      }
      const blob = { url: artistUploadBody.url };

      const res = await fetch('/api/hlyst-admin/artist-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: artistTitle,
          artist: artistArtist,
          composer: artistComposer,
          genre: artistGenre,
          durationSeconds: artistDuration,
          fileFormat: artistFormat,
          fileSizeBytes: artistFile.size,
          audioUrl: blob.url,
          artworkUrl,
          releaseStatus: artistReleaseStatus,
          releaseDate: artistReleaseDate || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setArtistError(body.error || 'Save failed.');
      } else {
        setArtistFile(null);
        setArtistTitle('');
        setArtistArtist('');
        setArtistComposer('');
        setArtistGenre('');
        setArtistDuration(null);
        setArtistFormat('');
        setArtistReleaseStatus('CURRENT');
        setArtistReleaseDate('');
        setArtistArtworkFile(null);
        setArtistArtworkPreview('');
        if (artistFileInputRef.current) artistFileInputRef.current.value = '';
        if (artistArtworkInputRef.current) artistArtworkInputRef.current.value = '';
        fetchArtistItems();
      }
    } catch (e) {
      setArtistError(e instanceof Error ? e.message : 'Upload failed.');
    }
    setArtistUploading(false);
  };

  const deleteArtistItem = async (id: number) => {
    if (!confirm('Delete this artist track? This removes the file permanently, not just from the list.')) return;
    await fetch('/api/hlyst-admin/artist-music', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    fetchArtistItems();
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
      const prodUploadForm = new FormData();
      prodUploadForm.append('file', prodFile);
      const prodUploadRes = await fetch('/api/hlyst-admin/production-music/upload', {
        method: 'POST',
        body: prodUploadForm,
      });
      const prodUploadBody = await prodUploadRes.json();
      if (!prodUploadRes.ok) {
        setProdError(prodUploadBody.error || 'Upload failed.');
        setProdUploading(false);
        return;
      }
      const blob = { url: prodUploadBody.url };

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
    if (tab === 'artist' && authed) {
      fetchArtistItems();
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

  const TabButton = ({ id, label }: { id: 'talkwave' | 'personas' | 'health' | 'breaks' | 'vm' | 'production' | 'artist'; label: string }) => (
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
        <TabButton id="artist" label="Artist Music" />
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
                  <span>{v.listener_name || 'Anonymous'}{v.category ? ` · ${v.category}` : ''}</span>
                  <span>{new Date(v.created_at).toLocaleString()} · {v.status}</span>
                </div>
                <audio controls src={v.audio_url} style={{ width: '100%' }} />
                {v.transcript ? (
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem', fontStyle: 'italic', color: '#ccc' }}>
                    "{v.transcript}"
                  </p>
                ) : (
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: '#c9944c' }}>
                    No transcript ({v.transcript_status || 'unknown'}) — listen to the audio directly to review.
                  </p>
                )}
                {v.transcript_status && v.transcript_status !== 'ok' && (
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: '#c9944c' }}>
                    Transcript status: {v.transcript_status}
                  </p>
                )}
                {v.safety_reason && (
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: '#666' }}>
                    {v.safety_reason}
                  </p>
                )}
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
                detail={health.imagingPersonaCount.ok ? `${health.imagingPersonaCount.count} found (should be 1)` : 'Unavailable'} />
              <HealthRow label="  — voice IDs assigned" ok={health.voicesAssignedCount.ok && health.voicesAssignedCount.count > 0}
                detail={health.voicesAssignedCount.ok ? `${health.voicesAssignedCount.count} of 16 set` : 'Unavailable'} />
              <HealthRow label="Schedule table" ok={health.scheduleTable.ok}
                detail={health.scheduleTable.ok ? `${health.scheduleTable.count} slots (should be 42)` : 'Not created yet'} />
              <HealthRow label="Talk Wave approved-item tracking" ok={health.talkWaveApprovedColumnReady.ok}
                detail={health.talkWaveApprovedColumnReady.ok ? `${health.talkWaveApprovedColumnReady.count} approved so far` : 'approved_at column not added yet'} />

              <button
                onClick={fetchHealth}
                style={{
                  marginTop: '1.5rem', border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent',
                  padding: '0.5rem 1.2rem', borderRadius: 999, cursor: 'pointer', fontSize: '0.85rem',
                }}
              >
                Re-check
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'breaks' && (
        <div>
          <div style={{ marginBottom: '1.5rem' }}>
            <button
              onClick={runEngineTick}
              disabled={tickLoading}
              style={{
                border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent',
                padding: '0.65rem 1.4rem', borderRadius: 8, cursor: 'pointer',
              }}
            >
              {tickLoading ? 'Running…' : 'Run engine tick now'}
            </button>
            <p style={{ color: '#888', fontSize: '0.8rem', marginTop: '0.6rem' }}>
              Manually runs the real decide-then-generate pipeline for whoever's on the current schedule slot right now.
              A real deployment would call this automatically every few minutes — that scheduling isn't wired up yet.
            </p>
          </div>

          {tickResult && (
            <div style={{
              background: '#111', border: `1px solid ${tickResult.error ? '#7a3030' : '#222'}`, borderRadius: 8,
              padding: '1rem 1.2rem', marginBottom: '1.5rem',
            }}>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#999' }}>
                {tickResult.personaName ? `${tickResult.personaName} — ` : ''}{tickResult.reason}
              </p>
              {tickResult.text && (
                <p style={{ margin: '0.6rem 0 0', fontStyle: 'italic', fontSize: '0.95rem' }}>{tickResult.text}</p>
              )}
              {tickResult.error && (
                <p style={{ margin: '0.6rem 0 0', color: '#e88', fontSize: '0.85rem' }}>{tickResult.error}</p>
              )}
            </div>
          )}

          <div style={{ borderTop: '1px solid #222', paddingTop: '1.5rem' }}>
            <label style={labelStyle}>Recent breaks (last 50)</label>
            {breaksLoading && <p style={{ color: '#888' }}>Loading…</p>}
            {!breaksLoading && breaksLog.length === 0 && (
              <p style={{ color: '#666', fontSize: '0.85rem' }}>Nothing generated yet — run a tick above, or wait for real activity once this is on a schedule.</p>
            )}
            {breaksLog.map((b) => (
              <div key={b.id} style={{
                padding: '0.9rem 0', borderBottom: '1px solid #1a1a1a',
                display: 'flex', justifyContent: 'space-between', gap: '1rem',
              }}>
                <div>
                  <div style={{ fontSize: '0.9rem' }}>
                    <b>{b.persona_name}</b> · {b.break_type}
                    {b.status === 'error' && <span style={{ color: '#e88' }}> · error</span>}
                    {b.status !== 'error' && b.audio_status === 'rendered' && <span style={{ color: '#8c8' }}> · audio</span>}
                    {b.status !== 'error' && b.audio_status === 'failed' && <span style={{ color: '#c9944c' }}> · audio failed</span>}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#ccc', marginTop: '0.2rem', fontStyle: 'italic' }}>
                    {b.text || b.error_detail}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{b.reason}</div>
                  {b.audio_url && (
                    <audio controls src={b.audio_url} style={{ width: '100%', marginTop: '0.5rem', height: 32 }} />
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#666', whiteSpace: 'nowrap' }}>
                  {new Date(b.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid #222', paddingTop: '1.5rem', marginTop: '1.5rem' }}>
            <label style={labelStyle}>Scheduler executions (last 30 — includes silent ticks)</label>
            {tickLog.length === 0 && (
              <p style={{ color: '#666', fontSize: '0.85rem' }}>No tick executions recorded yet.</p>
            )}
            {tickLog.map((t) => (
              <div key={t.id} style={{
                padding: '0.6rem 0', borderBottom: '1px solid #1a1a1a',
                display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.8rem',
              }}>
                <div style={{ color: t.error_detail ? '#e88' : t.skipped_duplicate ? '#c9944c' : t.should_speak ? '#8c8' : '#888' }}>
                  {t.error_detail ? `Error: ${t.error_detail}` :
                   t.skipped_duplicate ? `Duplicate skipped (${t.break_type})` :
                   t.should_speak ? `Spoke — ${t.break_type}` : `Silent — ${t.reason}`}
                </div>
                <div style={{ color: '#666', whiteSpace: 'nowrap' }}>{new Date(t.ran_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'vm' && (
        <div>
          <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            Vince Morgan — "The Messenger." Evergreen station imaging: generated once, reviewed here, approved,
            then reused — not regenerated on every play. VM never resolves as a scheduled DJ.
          </p>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={labelStyle}>Generate a new imaging asset</label>
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.4rem' }}>
              <select style={{ ...fieldStyle, flex: 1 }} value={vmGenerateType} onChange={(e) => setVmGenerateType(e.target.value)}>
                <option value="station_id">Station ID</option>
                <option value="show_transition">Show transition</option>
                <option value="talkwave_invite">Talk Wave invite</option>
                <option value="special_announcement">Special announcement</option>
                <option value="programming_notice">Programming notice</option>
                <option value="the_lyst_intro">The Lyst intro</option>
                <option value="interview_intro">Interview intro</option>
              </select>
              <button
                onClick={generateVmImaging}
                disabled={vmGenerating}
                style={{
                  border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent',
                  padding: '0.6rem 1.2rem', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {vmGenerating ? 'Generating…' : 'Generate'}
              </button>
            </div>
            {vmError && <p style={{ color: '#e88', fontSize: '0.85rem', marginTop: '0.75rem' }}>{vmError}</p>}
          </div>

          <div style={{ borderTop: '1px solid #222', paddingTop: '1.5rem' }}>
            <label style={labelStyle}>Imaging library ({vmItems.length})</label>
            {vmLoading && <p style={{ color: '#888' }}>Loading…</p>}
            {!vmLoading && vmItems.length === 0 && (
              <p style={{ color: '#666', fontSize: '0.85rem' }}>Nothing generated yet.</p>
            )}
            {vmItems.map((item) => (
              <div key={item.id} style={{ border: '1px solid #222', padding: '1rem', marginBottom: '0.75rem', borderRadius: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>
                  <span>
                    <b style={{ color: IVORY }}>{item.imaging_type.replace(/_/g, ' ')}</b>
                    {' · '}
                    <span style={{
                      color: item.status === 'approved' ? '#8c8' : item.status === 'archived' ? '#666' : '#c9944c',
                    }}>
                      {item.status}
                    </span>
                    {item.times_used > 0 && ` · used ${item.times_used}×`}
                  </span>
                  <span>{new Date(item.created_at).toLocaleString()}</span>
                </div>
                <p style={{ margin: 0, fontSize: '0.95rem', fontStyle: 'italic' }}>{item.text}</p>
                {item.audio_url && (
                  <audio controls src={item.audio_url} style={{ width: '100%', marginTop: '0.5rem' }} />
                )}
                {item.audio_status === 'failed' && (
                  <p style={{ color: '#c9944c', fontSize: '0.8rem', marginTop: '0.4rem' }}>Audio not rendered.</p>
                )}
                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  {['approved', 'archived', 'draft'].map((s) => (
                    <button
                      key={s}
                      onClick={() => updateVmStatus(item.id, s)}
                      disabled={item.status === s}
                      style={{
                        fontSize: '0.75rem', padding: '0.3rem 0.7rem', borderRadius: 999, cursor: 'pointer',
                        border: `1px solid ${item.status === s ? GOLD : '#333'}`,
                        color: item.status === s ? GOLD : '#999',
                        background: 'transparent', opacity: item.status === s ? 1 : 0.8,
                      }}
                    >
                      {s}
                    </button>
                  ))}
                  <button
                    onClick={() => deleteVmItem(item.id)}
                    style={{
                      fontSize: '0.75rem', padding: '0.3rem 0.7rem', borderRadius: 999, cursor: 'pointer',
                      border: '1px solid #622', color: '#e88', background: 'transparent', marginLeft: 'auto',
                    }}
                  >
                    delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'production' && (
        <div>
          <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            HLYST's own production library — beds, transitions, bumpers, imaging. These are not artist
            releases and are never described on-air as "new music." Artwork is optional.
          </p>

          <div style={{ border: '1px solid #222', borderRadius: 6, padding: '1.2rem', marginBottom: '2rem' }}>
            <label style={labelStyle}>Upload a production track</label>
            <input
              ref={prodFileInputRef}
              type="file"
              accept="audio/mpeg,audio/wav,audio/x-wav,audio/wave"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleProdFileSelect(f);
              }}
              style={{ ...fieldStyle, marginTop: '0.4rem' }}
            />

            {prodParsing && <p style={{ color: '#888', fontSize: '0.8rem', marginTop: '0.6rem' }}>Reading file…</p>}

            {prodFile && !prodParsing && (
              <>
                <label style={labelStyle}>Title (detected — edit if needed)</label>
                <input style={fieldStyle} value={prodTitle} onChange={(e) => setProdTitle(e.target.value)} />

                <label style={labelStyle}>Artist</label>
                <input style={fieldStyle} value={prodArtist} onChange={(e) => setProdArtist(e.target.value)} />

                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Composer (detected)</label>
                    <input style={fieldStyle} value={prodComposer} onChange={(e) => setProdComposer(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Genre (detected)</label>
                    <input style={fieldStyle} value={prodGenre} onChange={(e) => setProdGenre(e.target.value)} />
                  </div>
                </div>

                <p style={{ color: '#666', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                  Duration: {prodDuration ? `${Math.floor(prodDuration / 60)}:${String(prodDuration % 60).padStart(2, '0')}` : 'unknown'}
                  {' · '}Format: {prodFormat || 'unknown'}
                  {' · '}Size: {(prodFile.size / 1024 / 1024).toFixed(1)} MB
                </p>

                <label style={labelStyle}>Operational use (select all that apply)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.4rem' }}>
                  {['bed', 'transition', 'talkwave_bed', 'interview_bed', 'bumper', 'imaging', 'promo'].map((c) => (
                    <button
                      key={c}
                      onClick={() => toggleProdClassification(c)}
                      style={{
                        fontSize: '0.75rem', padding: '0.35rem 0.8rem', borderRadius: 999, cursor: 'pointer',
                        border: `1px solid ${prodClassifications.includes(c) ? GOLD : '#333'}`,
                        color: prodClassifications.includes(c) ? GOLD : '#999',
                        background: 'transparent',
                      }}
                    >
                      {c.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>

                {prodError && <p style={{ color: '#e88', fontSize: '0.85rem', marginTop: '0.75rem' }}>{prodError}</p>}

                <button
                  onClick={uploadProdTrack}
                  disabled={prodUploading || !prodTitle}
                  style={{
                    marginTop: '1.2rem', border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent',
                    padding: '0.6rem 1.5rem', borderRadius: 999, cursor: 'pointer',
                  }}
                >
                  {prodUploading ? 'Uploading…' : 'Upload & save'}
                </button>
              </>
            )}
          </div>

          <div style={{ borderTop: '1px solid #222', paddingTop: '1.5rem' }}>
            <label style={labelStyle}>Library ({prodItems.length})</label>
            {prodLoading && <p style={{ color: '#888' }}>Loading…</p>}
            {!prodLoading && prodItems.length === 0 && (
              <p style={{ color: '#666', fontSize: '0.85rem' }}>Nothing uploaded yet.</p>
            )}
            {prodItems.map((item) => (
              <div key={item.id} style={{ border: '1px solid #222', padding: '1rem', marginBottom: '0.75rem', borderRadius: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#888', marginBottom: '0.4rem' }}>
                  <span>
                    <span style={{ color: GOLD, fontFamily: 'monospace' }}>{item.hly_id}</span>
                    {' · '}
                    <b style={{ color: IVORY }}>{item.title}</b>
                    {' — '}{item.artist}
                  </span>
                  <span>{new Date(item.uploaded_at).toLocaleDateString()}</span>
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#999' }}>
                  {item.composer && `Composer: ${item.composer} · `}
                  {item.genre && `${item.genre} · `}
                  {item.duration_seconds ? `${Math.floor(item.duration_seconds / 60)}:${String(item.duration_seconds % 60).padStart(2, '0')} · ` : ''}
                  {item.file_format}
                </p>
                {item.classifications?.length > 0 && (
                  <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: '#c9944c' }}>
                    {item.classifications.map((c: string) => c.replace(/_/g, ' ')).join(', ')}
                  </p>
                )}
                <audio controls src={item.audio_url} style={{ width: '100%', marginTop: '0.5rem', height: 32 }} />
                <button
                  onClick={() => deleteProdItem(item.id)}
                  style={{
                    marginTop: '0.6rem', fontSize: '0.75rem', padding: '0.3rem 0.7rem', borderRadius: 999, cursor: 'pointer',
                    border: '1px solid #7a3030', color: '#e88', background: 'transparent',
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'artist' && (
        <div>
          <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            Real artist releases — kept operationally separate from HLYST's own production beds. Artist stays
            as detected, never overridden. Release status controls whether a DJ may call it "new."
          </p>

          <div style={{ border: '1px solid #222', borderRadius: 6, padding: '1.2rem', marginBottom: '2rem' }}>
            <label style={labelStyle}>Upload an artist track</label>
            <input
              ref={artistFileInputRef}
              type="file"
              accept="audio/mpeg,audio/wav,audio/x-wav,audio/wave"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleArtistFileSelect(f);
              }}
              style={{ ...fieldStyle, marginTop: '0.4rem' }}
            />

            {artistParsing && <p style={{ color: '#888', fontSize: '0.8rem', marginTop: '0.6rem' }}>Reading file…</p>}

            {artistFile && !artistParsing && (
              <>
                <label style={labelStyle}>Title (detected — edit if needed)</label>
                <input style={fieldStyle} value={artistTitle} onChange={(e) => setArtistTitle(e.target.value)} />

                <label style={labelStyle}>Artist (detected — edit if needed)</label>
                <input style={fieldStyle} value={artistArtist} onChange={(e) => setArtistArtist(e.target.value)} placeholder="e.g. Tarvona" />

                <label style={labelStyle}>Artwork (optional)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.4rem' }}>
                  {artistArtworkPreview && (
                    <img src={artistArtworkPreview} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4, border: '1px solid #333' }} />
                  )}
                  <input
                    ref={artistArtworkInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      setArtistArtworkFile(f || null);
                      setArtistArtworkPreview(f ? URL.createObjectURL(f) : '');
                    }}
                    style={{ ...fieldStyle, flex: 1 }}
                  />
                </div>
                <p style={{ color: '#666', fontSize: '0.75rem', marginTop: '0.3rem' }}>
                  No cover? Leave this blank — the site shows a clean placeholder instead, never a fake or broken image.
                </p>


                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Composer (detected)</label>
                    <input style={fieldStyle} value={artistComposer} onChange={(e) => setArtistComposer(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Genre (detected)</label>
                    <input style={fieldStyle} value={artistGenre} onChange={(e) => setArtistGenre(e.target.value)} />
                  </div>
                </div>

                <p style={{ color: '#666', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                  Duration: {artistDuration ? `${Math.floor(artistDuration / 60)}:${String(artistDuration % 60).padStart(2, '0')}` : 'unknown'}
                  {' · '}Format: {artistFormat || 'unknown'}
                  {' · '}Size: {(artistFile.size / 1024 / 1024).toFixed(1)} MB
                </p>

                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Release status</label>
                    <select style={fieldStyle} value={artistReleaseStatus} onChange={(e) => setArtistReleaseStatus(e.target.value)}>
                      <option value="NEW_RELEASE">New Release</option>
                      <option value="CURRENT">Current</option>
                      <option value="CATALOG">Catalog</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Release date (optional)</label>
                    <input type="date" style={fieldStyle} value={artistReleaseDate} onChange={(e) => setArtistReleaseDate(e.target.value)} />
                  </div>
                </div>
                <p style={{ color: '#666', fontSize: '0.75rem', marginTop: '0.4rem' }}>
                  Only tracks marked "New Release" here can be described on-air as new — this is an editorial
                  status you control, not a fixed expiration window.
                </p>

                {artistError && <p style={{ color: '#e88', fontSize: '0.85rem', marginTop: '0.75rem' }}>{artistError}</p>}

                <button
                  onClick={uploadArtistTrack}
                  disabled={artistUploading || !artistTitle || !artistArtist}
                  style={{
                    marginTop: '1.2rem', border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent',
                    padding: '0.6rem 1.5rem', borderRadius: 999, cursor: 'pointer',
                  }}
                >
                  {artistUploading ? 'Uploading…' : 'Upload & save'}
                </button>
              </>
            )}
          </div>

          <div style={{ borderTop: '1px solid #222', paddingTop: '1.5rem' }}>
            <label style={labelStyle}>Library ({artistItems.length})</label>
            {artistLoading && <p style={{ color: '#888' }}>Loading…</p>}
            {!artistLoading && artistItems.length === 0 && (
              <p style={{ color: '#666', fontSize: '0.85rem' }}>Nothing uploaded yet.</p>
            )}
            {artistItems.map((item) => (
              <div key={item.id} style={{ border: '1px solid #222', padding: '1rem', marginBottom: '0.75rem', borderRadius: 4, display: 'flex', gap: '0.9rem' }}>
                <div style={{
                  width: 48, height: 48, flexShrink: 0, borderRadius: 4, border: '1px solid #2a2a2a', background: '#161616',
                  backgroundImage: item.artwork_url ? `url(${encodeURI(item.artwork_url)})` : undefined,
                  backgroundSize: 'cover', backgroundPosition: 'center',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#888', marginBottom: '0.4rem' }}>
                  <span>
                    <b style={{ color: IVORY }}>{item.title}</b>
                    {' — '}{item.artist}
                    {' · '}
                    <span style={{
                      color: item.release_status === 'NEW_RELEASE' ? GOLD : item.release_status === 'CATALOG' ? '#666' : '#8c8',
                    }}>
                      {item.release_status.replace('_', ' ')}
                    </span>
                  </span>
                  <span>{new Date(item.uploaded_at).toLocaleDateString()}</span>
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#999' }}>
                  {item.composer && `Composer: ${item.composer} · `}
                  {item.genre && `${item.genre} · `}
                  {item.duration_seconds ? `${Math.floor(item.duration_seconds / 60)}:${String(item.duration_seconds % 60).padStart(2, '0')} · ` : ''}
                  {item.file_format}
                </p>
                <audio controls src={item.audio_url} style={{ width: '100%', marginTop: '0.5rem', height: 32 }} />
                <button
                  onClick={() => deleteArtistItem(item.id)}
                  style={{
                    marginTop: '0.6rem', fontSize: '0.75rem', padding: '0.3rem 0.7rem', borderRadius: 999, cursor: 'pointer',
                    border: '1px solid #7a3030', color: '#e88', background: 'transparent',
                  }}
                >
                  Delete
                </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HealthRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0', borderBottom: '1px solid #1a1a1a', fontSize: '0.9rem' }}>
      <span style={{ color: label.trim().startsWith('—') ? '#888' : IVORY }}>{label}</span>
      <span style={{ color: ok ? '#8c8' : '#e88', fontSize: '0.85rem' }}>{ok ? '✓ ' : '○ '}{detail}</span>
    </div>
  );
}
