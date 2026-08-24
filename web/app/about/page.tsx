export const metadata = { title: 'About — HLYST Radio' };

export default function AboutPage() {
  return (
    <div style={{ padding: '4rem 2rem', background: '#0a0a0a', minHeight: '100vh', color: '#f5f0e8', maxWidth: 720 }}>
      <a href="/" style={{ color: '#c9a44c', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block', marginBottom: '1.5rem' }}>
        ← Back to Home
      </a>
      <h1 style={{ fontSize: '2.25rem', fontWeight: 800, margin: '0 0 1.5rem' }}>About HLYST Radio</h1>

      <p style={{ color: '#e0dbd0', fontSize: '1.05rem', lineHeight: 1.7, margin: '0 0 2rem' }}>
        HLYST Radio is a cultural radio and editorial property — real DJs, real music,
        real culture. Not a nightclub. Not a streaming dashboard. Not automated
        programming. Every voice on air is a real person with a real perspective,
        curating sets that reflect genuine taste rather than an algorithm.
      </p>

      <div style={{ marginBottom: '2rem' }}>
        <p style={{ color: '#c9a44c', fontSize: '0.75rem', letterSpacing: '0.16em', margin: '0 0 1rem' }}>
          OUR STANDARD. OUR PROMISE.
        </p>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', fontSize: '0.95rem' }}>
          <span>Curated by Humans</span>
          <span>Earned Not Bought</span>
          <span>Culture First</span>
        </div>
      </div>

      <p style={{ color: '#999', fontSize: '0.9rem', lineHeight: 1.7, margin: '0 0 2rem' }}>
        The Lyst — HLYST's editorial picks — is earned, never for sale. No payola.
        No politics. Just excellence.
      </p>

      <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>
        HLYST Radio is a JH Broadcast Group property.
      </p>
    </div>
  );
}
