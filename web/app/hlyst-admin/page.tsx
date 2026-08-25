'use client';

import { useEffect, useState } from 'react';

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

// Matches the personas table (snake_case, as Postgres returns it) — kept
// separate from the camelCase shape the save API expects, and mapped
// explicitly below rather than guessed field-by-field.
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
  const [tab, setTab] = useState<'talkwave' | 'personas' | 'health'>('talkwave');

  const [personas, setPersonas] = useState<PersonaRow[]>([]);
  const [personasLoading, setPersonasLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PersonaRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

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

  const TabButton = ({ id, label }: { id: 'talkwave' | 'personas' | 'health'; label: string }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', paddingBottom:
