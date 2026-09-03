// HLYST Radio — homepage v2, built to the full creative brief:
// immersive editorial hero, real Now Playing strip, The Lyst, Coming Up,
// The Voices of HLYST, manifesto. Standalone — no dependency on SUB/WAVE's
// player system or any of its endpoints.
//
// Place this file at: web/app/page.tsx (REPLACES the current one entirely)

'use client';

import { useRef, useState, useEffect } from 'react';
import Image from 'next/image';
import { djs } from '@/lib/djs';
import { fetchOnAir, type OnAirResult } from '@/lib/schedule';

const STREAM_URL = process.env.NEXT_PUBLIC_LIVE365_STREAM_URL || '/stream.mp3';
const GOLD = '#c9a44c';
const BG = '#0a0a0a';
const IVORY = '#f5f0e8';

interface QueueTrackEntry {
  track?: { title?: string | null; artist?: string | null; album?: string | null } | null;
  introScript?: string | null;
  introPersona?: { name?: string | null } | null;
  startedAt?: string | null;
  endedAt?: string | null;
  requestedBy?: string | null;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function HomePage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [lystAdded, setLystAdded] = useState(false);
  const [talkWaveOpen, setTalkWaveOpen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [shareCopied, setShareCopied] = useState(false);

  const [twMode, setTwMode] = useState<'menu' | 'message' | 'voice' | null>(null);
  const [twName, setTwName] = useState('');
  const [twMessage, setTwMessage] = useState('');
  const [twStatus, setTwStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [twRecording, setTwRecording] = useState(false);
  const [twAudioBlob, setTwAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const emptyDj = {
    slug: '', name: '', onAirName: '', title: '', schedule: '',
    portrait: '', about: '', inHisLane: '', onAirStyle: '', theVibe: '',
    theAudience: '', whatHeBrings: '', trustedFor: '', signatureQuote: '',
  };
  const [onAirDj, setOnAirDj] = useState(emptyDj);
  const [comingUp, setComingUp] = useState<{ dj: typeof emptyDj; startsAt: string }>({ dj: emptyDj, startsAt: '' });
  const voices = djs.slice(0, 4);
  const [nowPlaying, setNowPlaying] = useState<{ live: boolean; title?: string; artist?: string; album?: string; artwork?: string; isNewRelease?: boolean } | null>(null);

  useEffect(() => {
    const fetchNowPlaying = () => {
      fetch('/api/now-playing')
        .then(res => res.json())
        .then((data) => {
          setNowPlaying({
            live: Boolean(data.streamOnline),
            title: data.nowPlaying?.title,
            artist: data.nowPlaying?.artist,
            album: data.nowPlaying?.album,
            artwork: data.nowPlaying?.artworkUrl,
            isNewRelease: data.nowPlaying?.isNewRelease,
          });
        })
        .catch(() => setNowPlaying({ live: false }));
    };
    fetchNowPlaying();
    const interval = setInterval(fetchNowPlaying, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchOnAir().then((result: OnAirResult) => {
      if (result.onAir) setOnAirDj(result.onAir);
      if (result.comingUp) setComingUp(result.comingUp);
    });
    const interval = setInterval(() => {
      fetchOnAir().then((result: OnAirResult) => {
        if (result.onAir) setOnAirDj(result.onAir);
        if (result.comingUp) setComingUp(result.comingUp);
      });
    }, 5 * 60 * 1000);
       return () => clearInterval(interval);
  }, []);

  const [recentUpcoming, setRecentUpcoming] = useState<{ recentPlays: QueueTrackEntry[]; upcoming: QueueTrackEntry[] }>({ recentPlays: [], upcoming: [] });

  useEffect(() => {
    const fetchRecentUpcoming = () => {
      fetch('/api/recent-upcoming')
        .then(res => res.json())
        .then((data) => {
          setRecentUpcoming({
            recentPlays: Array.isArray(data.recentPlays) ? data.recentPlays : [],
            upcoming: Array.isArray(data.upcoming) ? data.upcoming : [],
          });
        })
        .catch(() => {});
    };
    fetchRecentUpcoming();
    const interval = setInterval(fetchRecentUpcoming, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLystThis = () => {
    setLystAdded(true);
    setTimeout(() => setLystAdded(false), 2000);
  };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  };

    const handleSendMessage = async () => {
    if (!twMessage.trim()) return;
    setTwStatus('sending');
    try {
      const res = await fetch('/api/talkwave/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listenerName: twName, message: twMessage }),
      });
      if (!res.ok) throw new Error('failed');
      setTwStatus('sent');
      setTwMessage('');
    } catch {
      setTwStatus('error');
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        setTwAudioBlob(new Blob(chunks, { type: 'audio/webm' }));
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setTwRecording(true);
    } catch {
      setTwStatus('error');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setTwRecording(false);
  };

  const handleSendVoiceNote = async () => {
    if (!twAudioBlob) return;
    setTwStatus('sending');
    try {
      const formData = new FormData();
      formData.append('audio', twAudioBlob, 'voice-note.webm');
      formData.append('listenerName', twName);
      const res = await fetch('/api/talkwave/voice-note', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('failed');
      setTwStatus('sent');
      setTwAudioBlob(null);
    } catch {
      setTwStatus('error');
    }
  };

  const resetTalkWave = () => {
    setTwMode(null);
    setTwName('');
    setTwMessage('');
    setTwStatus('idle');
    setTwAudioBlob(null);
    setTwRecording(false);
  };

  const handleShare = async () => {
    const shareText = `Listening to ${onAirDj.onAirName} on HLYST Radio\nReal DJs. Real Music. Real Culture.`;
    const shareUrl = typeof window !== 'undefined' ? window.location.origin : '';
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'HLYST Radio', text: shareText, url: shareUrl });
      } catch {}
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      } catch {}
    }
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play().catch(() => {}); setPlaying(true); }
  };

  return (
    <div style={{ background: BG, color: IVORY, minHeight: '100vh' }}>
      <audio ref={audioRef} src={STREAM_URL} preload="none" />

      {/* HEADER */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1.25rem 2rem', borderBottom: `1px solid #222`,
      }}>
        <div style={{ fontSize: '1.3rem', fontWeight: 800, letterSpacing: '0.04em' }}>
          <span style={{ color: GOLD }}>HLYST</span>
          <span style={{ fontSize: '0.55rem', letterSpacing: '0.4em', color: '#888', marginLeft: '0.5rem' }}>RADIO</span>
        </div>
        <div style={{ display: 'flex', gap: '2.25rem', fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          <a href="#live" style={{ color: GOLD, textDecoration: 'none' }}>Live</a>
          <a href="#lyst" style={{ color: IVORY, textDecoration: 'none' }}>The Lyst</a>
          <a href="/schedule" style={{ color: IVORY, textDecoration: 'none' }}>Schedule</a>
          <a href="/djs" style={{ color: IVORY, textDecoration: 'none' }}>DJs</a>
          <a href="/interviews" style={{ color: IVORY, textDecoration: 'none' }}>Interviews</a>
          <a href="/about" style={{ color: IVORY, textDecoration: 'none' }}>About</a>
        </div>
        <button style={{
          border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent',
          padding: '0.55rem 1.25rem', fontSize: '0.75rem', letterSpacing: '0.1em',
          textTransform: 'uppercase', cursor: 'pointer', borderRadius: 999,
        }}>
          + Lyst This
        </button>
      </nav>

      {/* BROADCAST RAIL */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.55rem 2rem',
        borderBottom: '1px solid #222', fontSize: '0.7rem', letterSpacing: '0.1em',
      }}>
        <span style={{ color: GOLD }}>● LIVE 24/7</span>
        <span style={{ color: '#444' }}>|</span>
        <span style={{ color: GOLD, flex: 1, textAlign: 'center' }}>REAL DJS. REAL MUSIC. REAL CULTURE.</span>
        <span style={{ color: '#888' }}>128K MP3</span>
      </div>

      {/* IMMERSIVE HERO */}
      <div style={{ position: 'relative', minHeight: '620px', display: 'flex', alignItems: 'flex-end' }}>
        {onAirDj.portrait && (
  <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '58%', zIndex: 0 }}>
    <Image
      src={encodeURI(onAirDj.portrait)}
      alt={onAirDj.onAirName}
      fill
      style={{ objectFit: 'cover', objectPosition: 'center 30%' }}
      sizes="60vw"
      priority
    />
    <div style={{
      position: 'absolute', inset: 0,
      background: 'linear-gradient(90deg, #0a0a0a 0%, rgba(10,10,10,0.6) 25%, transparent 60%)',
    }} />
    <div style={{
      position: 'absolute', inset: 0,
      background: 'linear-gradient(180deg, transparent 55%, #0a0a0a 100%)',
    }} />
  </div>
)}
        <div style={{ position: 'relative', zIndex: 1, padding: '3rem 2rem', maxWidth: '520px' }}>
          <p style={{ color: GOLD, fontSize: '0.8rem', letterSpacing: '0.18em', margin: '0 0 0.75rem' }}>ON AIR NOW</p>
          <h1 style={{ fontSize: '4rem', fontWeight: 900, lineHeight: 0.95, margin: 0, textTransform: 'uppercase' }}>
            {onAirDj.name}
          </h1>
          <p style={{ color: '#ccc', fontSize: '1rem', letterSpacing: '0.05em', margin: '0.75rem 0 0.25rem' }}>
            {onAirDj.title}
          </p>
          <p style={{ color: GOLD, fontSize: '0.9rem', margin: '0 0 1.25rem' }}>{onAirDj.schedule}</p>
          <p style={{ color: '#e0dbd0', fontSize: '1rem', lineHeight: 1.6, margin: '0 0 1.5rem', maxWidth: '440px' }}>
            {onAirDj.about.split('.').slice(0, 2).join('.') + '.'}
          </p>
          <a href={`/djs/${onAirDj.slug}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            border: `1px solid ${GOLD}`, color: GOLD, padding: '0.65rem 1.4rem',
            fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase',
            textDecoration: 'none', borderRadius: 999,
          }}>
            About {onAirDj.name} →
          </a>
        </div>
      </div>

      {/* NOW PLAYING STRIP */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '1.75rem 2rem',
        borderBottom: '1px solid #222', flexWrap: 'wrap',
      }}>
                <div style={{
          width: 88, height: 88, background: '#161616', border: '1px solid #2a2a2a', flexShrink: 0,
          backgroundImage: nowPlaying?.artwork ? `url(${encodeURI(nowPlaying.artwork)})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
        }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ color: GOLD, fontSize: '0.7rem', letterSpacing: '0.14em', margin: '0 0 0.25rem' }}>NOW PLAYING</p>
          {nowPlaying?.live && nowPlaying.title ? (
            <>
              <p style={{ fontSize: '1.7rem', fontWeight: 800, margin: 0 }}>
                {nowPlaying.title}
                {nowPlaying.isNewRelease && (
                  <span style={{
                    marginLeft: '0.6rem', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em',
                    color: GOLD, border: `1px solid ${GOLD}`, borderRadius: 999, padding: '0.15rem 0.5rem',
                    verticalAlign: 'middle',
                  }}>
                    NEW
                  </span>
                )}
              </p>
              <p style={{ color: '#999', fontSize: '0.85rem', margin: '0.2rem 0 0' }}>
                {[nowPlaying.artist, nowPlaying.album].filter(Boolean).join(' · ')}
              </p>
            </>
          ) : (
            <p style={{ color: '#999', fontSize: '1rem', margin: 0 }}>Live on HLYST Radio</p>
          )}
        </div>
      
                <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} style={{
          width: 60, height: 60, borderRadius: '50%', background: GOLD, border: 'none',
          cursor: 'pointer', fontSize: '1.5rem', color: BG, flexShrink: 0,
        }}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <input
              type="range" min="0" max="1" step="0.01" value={volume}
              onChange={handleVolumeChange} aria-label="Volume"
              style={{ width: '70px', accentColor: GOLD }}
            />
            <button onClick={handleShare} style={{ background: 'none', border: 'none', color: '#888', fontSize: '0.75rem', letterSpacing: '0.06em', cursor: 'pointer', padding: 0 }}>
              {shareCopied ? 'LINK COPIED' : 'SHARE'}
            </button>
          </div>
          <button onClick={handleLystThis} style={{
            border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent',
            padding: '0.4rem 0.9rem', fontSize: '0.7rem', letterSpacing: '0.08em',
            textTransform: 'uppercase', cursor: 'pointer', borderRadius: 999,
          }}>
            {lystAdded ? 'Added to your Lyst' : '+ Lyst This'}
          </button>
        </div>
        
      </div>

            {/* RECENTLY PLAYED / UP NEXT */}
      {(recentUpcoming.recentPlays.length > 0 || recentUpcoming.upcoming.length > 0) && (
        <section style={{ padding: '3rem 2rem', borderBottom: '1px solid #222', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2.5rem' }}>
          {recentUpcoming.recentPlays.length > 0 && (
            <div>
              <p style={{ color: GOLD, fontSize: '0.75rem', letterSpacing: '0.16em', margin: '0 0 1.25rem' }}>RECENTLY PLAYED</p>
              {recentUpcoming.recentPlays.map((item, i) => (
                <div key={`rp-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', borderBottom: '1px solid #1a1a1a', padding: '0.85rem 0' }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.track?.title || 'Untitled'}
                    </p>
                    <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.track?.artist}
                    </p>
                    {item.introPersona?.name && (
                      <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: GOLD }}>
                        {item.introPersona.name} on the mic
                      </p>
                    )}
                  </div>
                  <span style={{ flexShrink: 0, fontSize: '0.7rem', color: '#666', paddingTop: '0.15rem' }}>
                    {timeAgo(item.endedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {recentUpcoming.upcoming.length > 0 && (
            <div>
              <p style={{ color: GOLD, fontSize: '0.75rem', letterSpacing: '0.16em', margin: '0 0 1.25rem' }}>UP NEXT</p>
              {recentUpcoming.upcoming.map((item, i) => (
                <div key={`up-${i}`} style={{ display: 'flex', alignItems: 'baseline', gap: '0.85rem', borderBottom: '1px solid #1a1a1a', padding: '0.85rem 0' }}>
                  <span style={{ fontSize: '1.1rem', fontWeight: 200, color: '#555', width: '1.5rem', flexShrink: 0 }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.track?.title || 'Untitled'}
                    </p>
                    <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.track?.artist}
                    </p>
                    {item.requestedBy && (
                      <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: GOLD }}>
                        requested by {item.requestedBy}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

            {/* FROM THE LYST */}
      <section id="lyst" style={{ padding: '3rem 2rem', borderBottom: '1px solid #222' }}>
        <p style={{ color: GOLD, fontSize: '0.75rem', letterSpacing: '0.16em', margin: '0 0 0.5rem' }}>FROM THE LYST</p>
        <p style={{ color: '#888', fontSize: '0.85rem', margin: '0 0 2rem', maxWidth: 480 }}>
          No payola. No politics. Just excellence. The Lyst is earned, never for sale.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '1.5rem' }}>
          <div style={{ background: '#111', border: '1px solid #222', padding: '2rem' }}>
            <p style={{ color: GOLD, fontSize: '0.7rem', letterSpacing: '0.14em', margin: '0 0 1rem' }}>FRONT OF THE LYST</p>
            <h3 style={{ fontSize: '1.8rem', fontWeight: 800, margin: '0 0 0.5rem' }}>The record everyone's talking about</h3>
            <p style={{ color: '#999', fontSize: '0.9rem', margin: 0 }}>This week's definitive pick, earned on merit alone.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ background: '#111', border: '1px solid #222', padding: '1.5rem' }}>
              <p style={{ color: GOLD, fontSize: '0.65rem', letterSpacing: '0.14em', margin: '0 0 0.5rem' }}>ON THE LYST</p>
              <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Rising this week</h4>
            </div>
            <div style={{ background: '#111', border: '1px solid #222', padding: '1.5rem' }}>
              <p style={{ color: GOLD, fontSize: '0.65rem', letterSpacing: '0.14em', margin: '0 0 0.5rem' }}>CERTIFIED LYST</p>
              <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>The permanent record</h4>
            </div>
          </div>
        </div>
      </section>

      {/* COMING UP */}
      {comingUp && (
        <section style={{ padding: '3rem 2rem', borderBottom: '1px solid #222', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: 160, height: 160, flexShrink: 0, borderRadius: '50%', overflow: 'hidden' }}>
            {comingUp.dj.portrait && (
              <Image src={encodeURI(comingUp.dj.portrait)} alt={comingUp.dj.onAirName} fill style={{ objectFit: 'cover' }} sizes="160px" />
            )}
          </div>
          <div>
            <p style={{ color: GOLD, fontSize: '0.75rem', letterSpacing: '0.16em', margin: '0 0 0.5rem' }}>COMING UP ON HLYST</p>
            <h3 style={{ fontSize: '2rem', fontWeight: 800, textTransform: 'uppercase', margin: 0 }}>{comingUp.dj.onAirName}</h3>
            <p style={{ color: GOLD, margin: '0.4rem 0' }}>{comingUp.startsAt} · {comingUp.dj.title}</p>
            <p style={{ color: '#ccc', maxWidth: 480, margin: '0.5rem 0 1rem' }}>
              {comingUp.dj.about.split('.')[0] + '.'}
            </p>
                        <a href={`/djs/${comingUp.dj.slug}`} style={{ color: GOLD, fontSize: '0.85rem', textDecoration: 'none' }}>
              Meet {comingUp.dj.name} →
            </a>
            <div style={{ display: 'flex', gap: '2rem', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #222' }}>
              <div>
                <p style={{ color: GOLD, fontSize: '0.7rem', letterSpacing: '0.1em', margin: 0 }}>NOW</p>
                <p style={{ color: IVORY, fontSize: '0.85rem', margin: '0.2rem 0 0' }}>{onAirDj.onAirName}</p>
              </div>
              <div>
                <p style={{ color: GOLD, fontSize: '0.7rem', letterSpacing: '0.1em', margin: 0 }}>{comingUp.startsAt}</p>
                <p style={{ color: IVORY, fontSize: '0.85rem', margin: '0.2rem 0 0' }}>{comingUp.dj.onAirName}</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* THE VOICES OF HLYST */}
      <section style={{ padding: '3rem 2rem', borderBottom: '1px solid #222' }}>
        <p style={{ color: GOLD, fontSize: '0.75rem', letterSpacing: '0.16em', margin: '0 0 2rem' }}>THE VOICES OF HLYST</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.25rem' }}>
          {voices.map(dj => (
            <a key={dj.slug} href={`/djs/${dj.slug}`} style={{ textDecoration: 'none', color: IVORY }}>
              <div style={{ position: 'relative', width: '100%', aspectRatio: '3/4', background: '#161616', marginBottom: '0.75rem' }}>
                {dj.portrait && <Image src={encodeURI(dj.portrait)} alt={dj.onAirName} fill style={{ objectFit: 'cover' }} sizes="25vw" />}
              </div>
              <p style={{ fontWeight: 700, fontSize: '0.95rem', margin: 0 }}>{dj.name}</p>
              <p style={{ color: GOLD, fontSize: '0.75rem', margin: '0.15rem 0 0' }}>{dj.title}</p>
              <p style={{ color: '#888', fontSize: '0.7rem', margin: '0.1rem 0 0' }}>{dj.schedule}</p>
            </a>
          ))}
        </div>
        <a href="/djs" style={{ color: GOLD, fontSize: '0.85rem', display: 'inline-block', marginTop: '1.5rem', textDecoration: 'none' }}>
          Meet all DJs →
        </a>
      </section>

                  {/* WAYS TO CONNECT */}
      <section style={{ padding: '3rem 2rem', borderBottom: '1px solid #222' }}>
        <p style={{ color: GOLD, fontSize: '0.75rem', letterSpacing: '0.16em', margin: '0 0 2rem' }}>WAYS TO CONNECT</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
          <div onClick={() => setTalkWaveOpen(true)} style={{ border: '1px solid #222', padding: '1.5rem', cursor: 'pointer' }}>
            <p style={{ color: IVORY, fontWeight: 700, margin: '0 0 0.4rem' }}>TALK WAVE</p>
            <p style={{ color: '#999', fontSize: '0.85rem', margin: 0 }}>Send the booth a message or voice note.</p>
          </div>
          <div onClick={handleShare} style={{ border: '1px solid #222', padding: '1.5rem', cursor: 'pointer' }}>
            <p style={{ color: IVORY, fontWeight: 700, margin: '0 0 0.4rem' }}>SHARE THE STATION</p>
            <p style={{ color: '#999', fontSize: '0.85rem', margin: 0 }}>{shareCopied ? 'Link copied.' : 'Send HLYST to a friend.'}</p>
          </div>
          <a href="/api/listen.pls" style={{ border: '1px solid #222', padding: '1.5rem', textDecoration: 'none', color: IVORY, display: 'block' }}>
            <p style={{ color: IVORY, fontWeight: 700, margin: '0 0 0.4rem' }}>TUNE IN ELSEWHERE</p>
            <p style={{ color: '#999', fontSize: '0.85rem', margin: 0 }}>One-tap link for Sonos, VLC, and hardware players.</p>
          </a>
        </div>
      </section>

                        {/* IN MY EAR INVITATION */}
      <section style={{ padding: '3rem 2rem', borderBottom: '1px solid #222', textAlign: 'center' }}>
        <p style={{ color: GOLD, fontSize: '0.75rem', letterSpacing: '0.16em', margin: '0 0 0.75rem' }}>IN MY EAR</p>
        <h3 style={{ fontSize: '1.6rem', fontWeight: 800, margin: '0 0 0.75rem' }}>The booth is listening.</h3>
        <button onClick={() => setTalkWaveOpen(true)} style={{
          border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent',
          padding: '0.65rem 1.5rem', fontSize: '0.8rem', letterSpacing: '0.1em',
          textTransform: 'uppercase', cursor: 'pointer', borderRadius: 999,
        }}>
          Open In My Ear
        </button>
      </section>

      {/* MANIFESTO */}

            {/* FOOTER */}
      <footer style={{ padding: '3rem 2rem', borderTop: '1px solid #222', fontSize: '0.8rem', color: '#999' }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: '#c9a44c', fontWeight: 800, fontSize: '1rem', margin: '0 0 0.25rem', letterSpacing: '0.04em' }}>
            HLYST RADIO
          </p>
          <p style={{ margin: 0, color: '#888' }}>REAL DJS. REAL MUSIC. REAL CULTURE.</p>
          <p style={{ margin: '0.25rem 0 0', color: '#888' }}>Cleveland · Worldwide</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', marginBottom: '1.5rem' }}>
          <a href="#live" style={{ color: '#999', textDecoration: 'none' }}>Listen Live</a>
          <a href="#lyst" style={{ color: '#999', textDecoration: 'none' }}>The Lyst</a>
          <a href="/schedule" style={{ color: '#999', textDecoration: 'none' }}>Schedule</a>
          <a href="/djs" style={{ color: '#999', textDecoration: 'none' }}>DJs</a>
          <a href="/interviews" style={{ color: '#999', textDecoration: 'none' }}>Interviews</a>
          <a href="/about" style={{ color: '#999', textDecoration: 'none' }}>About</a>
          <a href="#talkwave" style={{ color: '#999', textDecoration: 'none' }}>In My Ear</a>
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: '#c9a44c', fontSize: '0.7rem', letterSpacing: '0.14em', margin: '0 0 0.4rem' }}>OUR STANDARD</p>
          <p style={{ margin: 0, color: '#888' }}>Curated by Humans · Earned Not Bought · Culture First</p>
        </div>
        <div style={{ borderTop: '1px solid #222', paddingTop: '1.25rem', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <p style={{ margin: 0 }}>HLYST Radio is a JH Broadcast Group property.</p>
            <p style={{ margin: '0.25rem 0 0' }}>© 2026 JH Broadcast Group. All Rights Reserved.</p>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <a href="/hlyst-privacy" style={{ color: '#999', textDecoration: 'none' }}>Privacy</a>
            <a href="/hlyst-terms" style={{ color: '#999', textDecoration: 'none' }}>Terms</a>
            <a href="/contact" style={{ color: '#999', textDecoration: 'none' }}>Contact</a>
          </div>
        </div>
      </footer>
          

      {/* TALK WAVE FLOATING TRIGGER */}
      <button onClick={() => setTalkWaveOpen(true)} style={{
        position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 50,
        background: GOLD, color: BG, border: 'none', borderRadius: 999,
        padding: '0.85rem 1.5rem', fontSize: '0.75rem', letterSpacing: '0.08em',
        textTransform: 'uppercase', cursor: 'pointer', fontWeight: 700,
      }}>
               In My Ear
      </button>

      {/* IN MY EAR PANEL */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '380px', maxWidth: '90vw',
        background: '#0a0a0a', borderLeft: '1px solid #222', zIndex: 100,
        transform: talkWaveOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.35s ease', padding: '2rem', overflowY: 'auto',
      }}>
          <button onClick={() => { setTalkWaveOpen(false); resetTalkWave(); }} style={{
          background: 'none', border: 'none', color: '#888', fontSize: '1.2rem',
          cursor: 'pointer', marginBottom: '2rem', padding: 0,
        }}>
          ✕
        </button>
        <p style={{ color: GOLD, fontSize: '0.75rem', letterSpacing: '0.16em', margin: '0 0 0.5rem' }}>IN MY EAR</p>
        <h3 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.5rem' }}>The booth is listening.</h3>
        <p style={{ color: GOLD, fontSize: '0.85rem', margin: '0 0 2rem' }}>
          {onAirDj.onAirName}'s Line — Open
        </p>

                {twMode === null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div onClick={() => setTwMode('message')} style={{ border: '1px solid #222', padding: '1.25rem', cursor: 'pointer' }}>
              <p style={{ color: GOLD, fontSize: '0.7rem', letterSpacing: '0.12em', margin: '0 0 0.35rem' }}>MESSAGE</p>
              <p style={{ color: IVORY, fontWeight: 700, margin: '0 0 0.3rem' }}>Drop a Line</p>
              <p style={{ color: '#999', fontSize: '0.85rem', margin: 0 }}>Put it right here.</p>
            </div>
            <div onClick={() => setTwMode('voice')} style={{ border: '1px solid #222', padding: '1.25rem', cursor: 'pointer' }}>
              <p style={{ color: GOLD, fontSize: '0.7rem', letterSpacing: '0.12em', margin: '0 0 0.35rem' }}>VOICE NOTE</p>
              <p style={{ color: IVORY, fontWeight: 700, margin: '0 0 0.3rem' }}>Say It</p>
              <p style={{ color: '#999', fontSize: '0.85rem', margin: 0 }}>Let me hear it.</p>
            </div>
          </div>
        )}

        {twMode === 'message' && (
          <div>
            {twStatus === 'sent' ? (
              <>
                <p style={{ color: GOLD, fontWeight: 700, margin: '0 0 1rem' }}>Message sent to the booth.</p>
                <button onClick={resetTalkWave} style={{ background: 'none', border: `1px solid ${GOLD}`, color: GOLD, padding: '0.5rem 1rem', borderRadius: 999, cursor: 'pointer' }}>Done</button>
              </>
            ) : (
              <>
                <input
                  placeholder="Your name (optional)"
                  value={twName}
                  onChange={(e) => setTwName(e.target.value)}
                  style={{ width: '100%', background: '#111', border: '1px solid #222', color: IVORY, padding: '0.65rem', borderRadius: 4, marginBottom: '0.75rem' }}
                />
                <textarea
                  placeholder="Your message to the booth"
                  value={twMessage}
                  onChange={(e) => setTwMessage(e.target.value)}
                  rows={4}
                  style={{ width: '100%', background: '#111', border: '1px solid #222', color: IVORY, padding: '0.65rem', borderRadius: 4, marginBottom: '0.75rem', resize: 'vertical' }}
                />
                {twStatus === 'error' && <p style={{ color: '#e88', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>Something went wrong — try again.</p>}
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button onClick={handleSendMessage} disabled={twStatus === 'sending' || !twMessage.trim()} style={{
                    border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent', padding: '0.6rem 1.25rem',
                    borderRadius: 999, cursor: 'pointer', opacity: twStatus === 'sending' || !twMessage.trim() ? 0.5 : 1,
                  }}>
                    {twStatus === 'sending' ? 'Sending…' : 'Send'}
                  </button>
                  <button onClick={resetTalkWave} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>Cancel</button>
                </div>
              </>
            )}
          </div>
        )}

        {twMode === 'voice' && (
          <div>
            {twStatus === 'sent' ? (
              <>
                <p style={{ color: GOLD, fontWeight: 700, margin: '0 0 1rem' }}>Voice note sent to the booth.</p>
                <button onClick={resetTalkWave} style={{ background: 'none', border: `1px solid ${GOLD}`, color: GOLD, padding: '0.5rem 1rem', borderRadius: 999, cursor: 'pointer' }}>Done</button>
              </>
            ) : (
              <>
                <input
                  placeholder="Your name (optional)"
                  value={twName}
                  onChange={(e) => setTwName(e.target.value)}
                  style={{ width: '100%', background: '#111', border: '1px solid #222', color: IVORY, padding: '0.65rem', borderRadius: 4, marginBottom: '1rem' }}
                />
                {!twAudioBlob ? (
                  <button
                    onClick={twRecording ? stopRecording : startRecording}
                    style={{
                      border: `1px solid ${twRecording ? '#e88' : GOLD}`, color: twRecording ? '#e88' : GOLD,
                      background: 'transparent', padding: '0.75rem 1.5rem', borderRadius: 999, cursor: 'pointer', width: '100%',
                    }}
                  >
                    {twRecording ? '● Stop Recording' : '● Start Recording'}
                  </button>
                ) : (
                  <>
                    <audio controls src={URL.createObjectURL(twAudioBlob)} style={{ width: '100%', marginBottom: '1rem' }} />
                    {twStatus === 'error' && <p style={{ color: '#e88', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>Something went wrong — try again.</p>}
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      <button onClick={handleSendVoiceNote} disabled={twStatus === 'sending'} style={{
                        border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent', padding: '0.6rem 1.25rem',
                        borderRadius: 999, cursor: 'pointer', opacity: twStatus === 'sending' ? 0.5 : 1,
                      }}>
                        {twStatus === 'sending' ? 'Sending…' : 'Send'}
                      </button>
                      <button onClick={() => setTwAudioBlob(null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>Re-record</button>
                    </div>
                  </>
                )}
                <button onClick={resetTalkWave} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', marginTop: '0.75rem', display: 'block' }}>Cancel</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
