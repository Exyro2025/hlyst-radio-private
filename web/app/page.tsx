// HLYST Radio — homepage v2, built to the full creative brief:
// immersive editorial hero, real Now Playing strip, The Lyst, Coming Up,
// The Voices of HLYST, manifesto. Standalone — no dependency on SUB/WAVE's
// player system or any of its endpoints.
//
// Place this file at: web/app/page.tsx (REPLACES the current one entirely)

'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { djs } from '@/lib/djs';
import { getOnAirNow, getComingUp } from '@/lib/schedule';

const STREAM_URL = process.env.NEXT_PUBLIC_STREAM_URL || '';
const GOLD = '#c9a44c';
const BG = '#0a0a0a';
const IVORY = '#f5f0e8';

export default function HomePage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const onAirDj = getOnAirNow();
  const comingUp = getComingUp();
  const voices = djs.slice(0, 4);

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
          <a href="#interviews" style={{ color: IVORY, textDecoration: 'none' }}>Interviews</a>
          <a href="#about" style={{ color: IVORY, textDecoration: 'none' }}>About</a>
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
  <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
    <Image
      src={encodeURI(onAirDj.portrait)}
      alt={onAirDj.onAirName}
      fill
      style={{ objectFit: 'cover', objectPosition: 'center 75%' }}
      sizes="100vw"
      priority
    />
    <div style={{ position: 'absolute', inset: 0,
      background: 'linear-gradient(90deg, #0a0a0a 0%, #0a0a0a 38%, rgba(10,10,10,0.75) 50%, rgba(10,10,10,0.15) 65%, transparent 100%)' }} />
    <div style={{ position: 'absolute', inset: 0,
      background: 'linear-gradient(180deg, transparent 55%, #0a0a0a 100%)' }} />
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
        <div style={{ width: 88, height: 88, background: '#161616', border: '1px solid #2a2a2a', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ color: GOLD, fontSize: '0.7rem', letterSpacing: '0.14em', margin: '0 0 0.25rem' }}>NOW PLAYING</p>
          <p style={{ fontSize: '1.7rem', fontWeight: 800, margin: 0 }}>Gold</p>
          <p style={{ color: '#999', fontSize: '0.85rem', margin: '0.2rem 0 0' }}>Cleo Sol · Gold · 2023</p>
          <div style={{ height: 2, background: '#222', marginTop: '0.75rem', maxWidth: 320 }}>
            <div style={{ width: '35%', height: '100%', background: GOLD }} />
          </div>
        </div>
        <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} style={{
          width: 60, height: 60, borderRadius: '50%', background: GOLD, border: 'none',
          cursor: 'pointer', fontSize: '1.5rem', color: BG, flexShrink: 0,
        }}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div style={{ fontSize: '0.75rem', color: '#888', lineHeight: 1.6 }}>
          <p style={{ margin: 0 }}>Previously: Different — PJ Morton</p>
          <p style={{ margin: 0 }}>Next: Do 4 Love — Snoh Aalegra</p>
        </div>
      </div>

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

      {/* MANIFESTO */}
      <section style={{ padding: '4rem 2rem', textAlign: 'center', borderBottom: '1px solid #222' }}>
        <p style={{ color: GOLD, fontSize: '0.75rem', letterSpacing: '0.2em', margin: '0 0 1.5rem' }}>
          OUR STANDARD. OUR PROMISE.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '3rem', flexWrap: 'wrap', marginBottom: '2rem', fontSize: '0.85rem', letterSpacing: '0.08em' }}>
          <span>CURATED BY HUMANS</span>
          <span>EARNED NOT BOUGHT</span>
          <span>CULTURE FIRST</span>
        </div>
        <h2 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '0.02em', margin: 0 }}>
          REAL DJS.<br />REAL MUSIC.<br />REAL CULTURE.
        </h2>
      </section>

      {/* FOOTER */}
      <footer style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#666' }}>
        <span>© 2026 HLYST Radio</span>
        <span style={{ display: 'flex', gap: '1rem' }}>
          <a href="#" style={{ color: '#666' }}>Privacy</a>
          <a href="#" style={{ color: '#666' }}>Terms</a>
          <a href="#" style={{ color: '#666' }}>Contact</a>
        </span>
      </footer>
    </div>
  );
}
