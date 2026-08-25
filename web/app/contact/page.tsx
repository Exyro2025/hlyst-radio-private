'use client';

import { useState } from 'react';

const GOLD = '#c9a44c';
const IVORY = '#f5f0e8';

const SUBJECT_OPTIONS = [
  'General Inquiry',
  'Programming',
  'Music / Artist Submission',
  'Editorial / The Lyst',
  'Interviews',
  'Press & Media',
  'Partnerships / Business',
  'Technical Support',
  'Privacy',
  'Other',
];

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#111',
  border: '1px solid #222',
  color: IVORY,
  padding: '0.75rem 1rem',
  fontSize: '0.95rem',
  borderRadius: 4,
  marginBottom: '1.25rem',
};

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);

  return (
    <div style={{ padding: '4rem 2rem', background: '#0a0a0a', minHeight: '100vh', color: IVORY, maxWidth: 600, margin: '0 auto' }}>
      <a href="/" style={{ color: GOLD, fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block', marginBottom: '1.5rem' }}>
        ← Back to Home
      </a>
      <h1 style={{ fontSize: '2.25rem', fontWeight: 800, margin: '0 0 0.5rem' }}>Contact HLYST</h1>
      <p style={{ color: GOLD, fontSize: '1.05rem', margin: '0 0 2.5rem' }}>We're Listening.</p>

      <p style={{ color: '#ccc', fontSize: '0.95rem', lineHeight: 1.7, margin: '0 0 2.5rem' }}>
        For general inquiries, programming matters, editorial correspondence, artist or industry
        inquiries, technical issues, and other HLYST business, use the contact form below.
      </p>

      <form onSubmit={(e) => { e.preventDefault(); }}>
        <label style={{ display: 'block', color: '#999', fontSize: '0.8rem', marginBottom: '0.4rem' }}>Name</label>
        <input type="text" style={inputStyle} disabled />

        <label style={{ display: 'block', color: '#999', fontSize: '0.8rem', marginBottom: '0.4rem' }}>Email</label>
        <input type="email" style={inputStyle} disabled />

        <label style={{ display: 'block', color: '#999', fontSize: '0.8rem', marginBottom: '0.4rem' }}>Subject</label>
        <select style={inputStyle} disabled defaultValue="">
          <option value="" disabled>Select a subject</option>
          {SUBJECT_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <label style={{ display: 'block', color: '#999', fontSize: '0.8rem', marginBottom: '0.4rem' }}>Message</label>
        <textarea rows={5} style={{ ...inputStyle, resize: 'vertical' }} disabled />

        <button
          type="submit"
          disabled
          style={{
            border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent',
            padding: '0.75rem 2rem', fontSize: '0.85rem', letterSpacing: '0.1em',
            textTransform: 'uppercase', cursor: 'not-allowed', borderRadius: 999,
            opacity: 0.5, width: '100%',
          }}
        >
          Send Message
        </button>
        <p style={{ color: '#666', fontSize: '0.8rem', marginTop: '0.75rem', textAlign: 'center' }}>
          This form is not yet connected — submissions are currently disabled.
        </p>
      </form>

      <div style={{ borderTop: '1px solid #222', marginTop: '3rem', paddingTop: '2rem' }}>
        <p style={{ color: GOLD, fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
          Listener interaction belongs in Talk Wave.
        </p>
        <p style={{ color: '#999', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
          Want to join the conversation, send the booth a message, leave a voice note, or
          participate in the show? Use Talk Wave rather than this business contact form.
        </p>
      </div>

      <div style={{ marginTop: '3rem', color: '#888', fontSize: '0.85rem' }}>
        <p style={{ margin: 0 }}>HLYST Radio</p>
        <p style={{ margin: '0.2rem 0 1rem' }}>Cleveland • Worldwide</p>
        <p style={{ margin: 0 }}>A JH Broadcast Group property.</p>
      </div>
    </div>
  );
}
