// HLYST Radio — the real homepage, built to the actual design mockups.
// Standalone: does NOT depend on SUB/WAVE's player system (PlayerApp, skins,
// /api/state, /api/session, /api/themes) — none of that touched here.
//
// Place this file at: web/app/page.tsx (replaces the current one entirely)
//
// Data sources:
//   - DJ roster: web/lib/djs.ts (already built, real)
//   - "On air now" / "Coming up": derived from djs.ts schedule strings —
//     [PLACEHOLDER LOGIC] real schedule matching comes later; for now shows
//     the first DJ in the list as a demo.
//   - Now Playing track info: [PLACEHOLDER] — Live365 metadata isn't
//     confirmed reachable yet (see earlier README). Shows placeholder text
//     until that's wired.
//   - Audio stream: reads NEXT_PUBLIC_STREAM_URL env var directly.

'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { djs } from '@/lib/djs';

const STREAM_URL = process.env.NEXT_PUBLIC_STREAM_URL || '';

export default function HomePage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  // [PLACEHOLDER] Demo pick — real "who's on air now" logic comes once a
  // real schedule/controller exists. Swap for real logic later.
  const onAirDj = djs[0];
  const comingUpDj = djs[1];

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play().catch(() => {});
      setPlaying(true);
    }
  };

  return (
    <div style={{ background: '#0a0a0a', color: '#f5f0e8', minHeight: '100vh', fontFamily: 'inherit' }}>
      {/* audio element — hidden, controlled by the play buttons below */}
      <audio ref={audioRef} src={STREAM_URL} preload="none" />

      {/* TOP NAV */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1.25rem 2rem', borderBottom: '1px solid #2a2a2a',
      }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '0.05em' }}>
          <span style={{ color: '#c9a44c' }}>HLYST</span>
          <div style={{ fontSize: '0.6rem', letterSpacing: '0.4em', color: '#999', marginTop: '-2px' }}>RADIO</div>
        </div>
        <div style={{ display: 'flex', gap: '2rem', fontSize: '0.85rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          <a href="#live" style={{ color: '#c9a44c', textDecoration: 'none' }}>Live</a>
          <a href="#lyst" style={{ color: '#e8e2d5', textDecoration: 'none' }}>The Lyst</a>
          <a href="/schedule" style={{ color: '#e8e2d5', textDecoration: 'none' }}>Schedule</a>
          <a href="/djs" style={{ color: '#e8e2d5', textDecoration: 'none' }}>DJs</a>
          <a href="#interviews" style={{ color: '#e8e2d5', textDecoration: 'none' }}>Interviews</a>
          <a href="#about" style={{ color: '#e8e2d5', textDecoration: 'none' }}>About</a>
        </div>
        <button style={{
          border: '1px solid #c9a44c', color: '#c9a44c', background: 'transparent',
          padding: '0.5rem 1.25rem', fontSize: '0.8rem', letterSpacing: '0.08em',
          textTransform: 'uppercase', cursor: 'pointer', borderRadius: 999,
        }}>
          + Lyst This
        </button>
      </nav>

      {/* STATUS BAR */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.6rem 2rem',
        borderBottom: '1px solid #2a2a2a', fontSize: '0.75rem', letterSpacing: '0.08em',
      }}>
        <span style={{ color: '#c9a44c' }}>● LIVE 24/7</span>
        <span style={{ color: '#666' }}>|</span>
        <span style={{ color: '#c9a44c', flex: 1, textAlign: 'center' }}>
          REAL DJS. REAL MUSIC. REAL CULTURE.
        </span>
        <span style={{ color: '#999' }}>128K MP3</span>
      </div>

      {/* HERO — ON AIR NOW */}
      <div style={{ position: 'relative', minHeight: '480px', display: 'flex', alignItems: 'flex-end', padding: '2.5rem 2rem' }}>
        {onAirDj?.portrait && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
            <Image
              src={onAirDj.portrait}
              alt={onAirDj.onAirName}
              fill
              style={{ objectFit: 'cover', objectPosition: 'top', opacity: 0.65 }}
              sizes="100vw"
            />
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(90deg, #0a0a0a 20%, transparent 60%)',
            }} />
          </div>
        )}
        <div style={{ position: 'relative', zIndex: 1, maxWidth: '480px' }}>
          <p style={{ color: '#c9a44c', fontSize: '0.85rem', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
            ON AIR NOW
          </p>
          <h1 style={{ fontSize: '3rem', fontWeight: 800, lineHeight: 1.05, margin: 0, textTransform: 'uppercase' }}>
            {onAirDj?.name || 'HLYST'}
          </h1>
          <p style={{ color: '#c9a44c', fontSize: '1rem', margin: '0.75rem 0 0.25rem' }}>
            {onAirDj?.schedule || ''}
          </p>
          <p style={{ color: '#e8e2d5', fontSize: '0.95rem', lineHeight: 1.5, margin: '0.5rem 0 1.25rem' }}>
            {onAirDj?.theVibe || ''}
          </p>
          <a href={`/djs/${onAirDj?.slug}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            border: '1px solid #c9a44c', color: '#c9a44c', padding: '0.6rem 1.25rem',
            fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase',
            textDecoration: 'none', borderRadius: 999,
          }}>
            About {onAirDj?.name} →
          </a>
        </div>
      </div>

      {/* NOW PLAYING CARD */}
      <div style={{
        margin: '0 2rem', padding: '1.5rem', background: '#141414',
        border: '1px solid #2a2a2a', borderRadius: 8,
        display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap',
      }}>
        <div style={{ width: 96, height: 96, background: '#2a2a2a', borderRadius: 6, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ color: '#c9a44c', fontSize: '0.75rem', letterSpacing: '0.08em', margin: 0 }}>NOW PLAYING</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.2rem 0' }}>
            {/* [PLACEHOLDER] real track title once Live365 metadata is confirmed */}
            Scanning the dial…
          </p>
          <p style={{ color: '#999', margin: 0 }}>HLYST Radio</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={togglePlay}
            style={{
              width: 56, height: 56, borderRadius: '50%', background: '#c9a44c',
              border: 'none', cursor: 'pointer', fontSize: '1.4rem', color: '#0a0a0a',
            }}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
        </div>
      </div>

      {/* COMING UP + QUICK LINKS */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '1.5rem', margin: '2rem', maxWidth: 1200,
      }}>
        <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, padding: '1.25rem' }}>
          <p style={{ color: '#c9a44c', fontSize: '0.75rem', letterSpacing: '0.08em', margin: '0 0 0.75rem' }}>
            COMING UP
          </p>
          {comingUpDj && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {comingUpDj.portrait && (
                <div style={{ position: 'relative', width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                  <Image src={comingUpDj.portrait} alt={comingUpDj.onAirName} fill style={{ objectFit: 'cover' }} sizes="48px" />
                </div>
              )}
              <div>
                <p style={{ fontWeight: 700, margin: 0 }}>{comingUpDj.onAirName}</p>
                <p style={{ color: '#999', fontSize: '0.85rem', margin: 0 }}>{comingUpDj.schedule}</p>
              </div>
            </div>
          )}
          <a href="/schedule" style={{ color: '#c9a44c', fontSize: '0.85rem', display: 'block', marginTop: '1rem', textDecoration: 'none' }}>
            View schedule →
          </a>
        </div>

        <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, padding: '1.25rem' }}>
          <p style={{ color: '#c9a44c', fontSize: '0.75rem', letterSpacing: '0.08em', margin: '0 0 0.75rem' }}>
            WAYS TO CONNECT
          </p>
          <p style={{ color: '#e8e2d5', fontSize: '0.9rem', margin: '0.4rem 0' }}>+ Lyst This — request a song</p>
          <p style={{ color: '#e8e2d5', fontSize: '0.9rem', margin: '0.4rem 0' }}>Artist submissions</p>
          <p style={{ color: '#e8e2d5', fontSize: '0.9rem', margin: '0.4rem 0' }}>@HLYSTRADIO — follow everywhere</p>
        </div>
      </div>

      {/* FOOTER */}
      <footer style={{
        borderTop: '1px solid #2a2a2a', padding: '1.5rem 2rem',
        display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#666',
      }}>
        <span>© 2026 HLYST Radio · Real DJs. Real music. Real culture.</span>
        <span style={{ display: 'flex', gap: '1rem' }}>
          <a href="#" style={{ color: '#666' }}>Privacy</a>
          <a href="#" style={{ color: '#666' }}>Terms</a>
          <a href="#" style={{ color: '#666' }}>Contact</a>
        </span>
      </footer>
    </div>
  );
}
