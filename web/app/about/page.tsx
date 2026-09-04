export const metadata = { title: 'About — HLYST Radio' };

export default function AboutPage() {
  return (
    <div style={{ padding: '4rem 2rem', background: '#0a0a0a', minHeight: '100vh', color: '#f5f0e8', maxWidth: 720 }}>
      <a href="/" style={{ color: '#c9a44c', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block', marginBottom: '1.5rem' }}>
        ← Back to Home
      </a>
      <h1 style={{ fontSize: '2.25rem', fontWeight: 800, margin: '0 0 1.5rem' }}>About HLYST Radio</h1>

      <p style={{ color: '#e0dbd0', fontSize: '1.05rem', lineHeight: 1.7, margin: '0 0 1.5rem' }}>
        HLYST Radio is a Cleveland-rooted, worldwide digital radio station built around
        real DJs, intentional music curation, cultural credibility, discovery, and human
        connection. Its standard is simple: Real DJs. Real Music. Real Culture. Programming
        is curated by people with distinct musical identities—not generated playlists
        chasing algorithms. HLYST moves across generations and genres while respecting the
        history behind the music and creating room for what deserves to be heard next.
      </p>

      <p style={{ color: '#e0dbd0', fontSize: '1.05rem', lineHeight: 1.7, margin: '0 0 1.5rem' }}>
        HLYST believes influence should be earned, not bought. Editorial recognition, The
        Lyst, interviews, and cultural coverage are governed by that principle. Commercial
        relationships do not purchase editorial approval.
      </p>

      <p style={{ color: '#e0dbd0', fontSize: '1.05rem', lineHeight: 1.7, margin: '0 0 2rem' }}>
        Through its DJs, specialty programming, The Lyst, interviews, and In My Ear, HLYST
        is designed to feel less like a streaming platform and more like what great radio
        has always been: a place with taste, personality, discovery, conversation, and a
        point of view.
      </p>

      <p style={{ color: '#c9a44c', fontSize: '0.95rem', margin: 0 }}>Cleveland • Worldwide.</p>
    </div>
  );
}
