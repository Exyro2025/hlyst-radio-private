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
      <h1 style={{ fontSize: '2.25rem', fontWeight: 800, margin: '0 0 1rem' }}>Interviews</h1>
      <p style={{ color: '#999', fontSize: '0.9rem', margin: '0 0 2.5rem', maxWidth: 520 }}>
        Interviews are concise, substantive, and music/culture-led. Sponsorship does not
        buy favorable editorial treatment.
      </p>

      {/* FEATURED — one huge feature per brief, placeholder until a guest is confirmed */}
      <div style={{ background: '#111', border: '1px solid #222', padding: '2.5rem', marginBottom: '2.5rem' }}>
        <div style={{
          width: '100%', aspectRatio: '16/9', background: '#161616', marginBottom: '1.5rem',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: '#444', fontSize: '0.8rem', letterSpacing: '0.1em' }}>PLACEHOLDER — NO GUEST CONFIRMED</span>
        </div>
        <p style={{ color: '#c9a44c', fontSize: '0.7rem', letterSpacing: '0.14em', margin: '0 0 0.5rem' }}>
          FEATURED CONVERSATION — TO BE ANNOUNCED
        </p>
        <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: '0 0 0.5rem', color: '#666' }}>
          Editorial slot reserved
        </h2>
        <p style={{ color: '#666', fontSize: '0.9rem', margin: 0 }}>
          This feature will go live once a confirmed guest and interview are ready to publish.
        </p>
      </div>

      {/* SMALLER INTERVIEWS UNDERNEATH — per brief structure, same placeholder honesty */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1.5rem' }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ background: '#111', border: '1px solid #222', padding: '1.5rem' }}>
            <div style={{
              width: '100%', aspectRatio: '4/3', background: '#161616', marginBottom: '1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: '#444', fontSize: '0.7rem' }}>PLACEHOLDER</span>
            </div>
            <h3 style={{ fontSize: '1.05rem', margin: '0 0 0.4rem', color: '#666' }}>Reserved slot</h3>
            <p style={{ color: '#666', fontSize: '0.85rem', margin: 0 }}>No interview confirmed yet.</p>
          </div>
        ))}
      </div>
    </div>
  );
}
