export const metadata = { title: 'Interviews — HLYST Radio' };

export default function InterviewsPage() {
  return (
    <div style={{ padding: '4rem 2rem', background: '#0a0a0a', minHeight: '100vh', color: '#f5f0e8' }}>
      <a href="/" style={{ color: '#c9a44c', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block', marginBottom: '1.5rem' }}>
        ← Back to Home
      </a>
      <p style={{ color: '#c9a44c', fontSize: '0.75rem', letterSpacing: '0.16em', margin: '0 0 0.5rem' }}>
        HLYST CONVERSATIONS
      </p>
      <h1 style={{ fontSize: '2.25rem', fontWeight: 800, margin: '0 0 2.5rem' }}>Interviews</h1>

      {/* Featured interview — placeholder until real content is added */}
      <div style={{ background: '#111', border: '1px solid #222', padding: '2.5rem', marginBottom: '2.5rem' }}>
        <div style={{ width: '100%', aspectRatio: '16/9', background: '#161616', marginBottom: '1.5rem' }} />
        <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: '0 0 0.5rem' }}>Featured Conversation</h2>
        <p style={{ color: '#999', fontSize: '0.95rem', margin: '0 0 1rem' }}>
          Real interview content coming soon — concise, substantive, music and culture-led.
          No sponsorship buys favorable editorial treatment.
        </p>
        <span style={{ color: '#c9a44c', fontSize: '0.85rem' }}>Watch / Listen →</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1.5rem' }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ background: '#111', border: '1px solid #222', padding: '1.5rem' }}>
            <div style={{ width: '100%', aspectRatio: '4/3', background: '#161616', marginBottom: '1rem' }} />
            <h3 style={{ fontSize: '1.05rem', margin: '0 0 0.4rem' }}>Coming soon</h3>
            <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>Interview content to be added.</p>
          </div>
        ))}
      </div>
    </div>
  );
}
