const GOLD = '#c9a44c';
const BG = '#0a0a0a';
const IVORY = '#f5f0e8';

export default function NotFound() {
  return (
    <div style={{ background: BG, color: IVORY, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: '480px', textAlign: 'center' }}>
        <p style={{ color: GOLD, fontSize: '0.75rem', letterSpacing: '0.16em', margin: '0 0 1rem' }}>OFF THE DIAL</p>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 900, margin: '0 0 1rem', textTransform: 'uppercase' }}>Dead Air.</h1>
        <p style={{ color: '#ccc', fontSize: '1rem', lineHeight: 1.6, margin: '0 0 2rem' }}>
          There's nothing broadcasting on this frequency. The page you asked for either moved, never existed, or was pulled from the schedule. The stream itself is unaffected — the music keeps playing whatever this page does.
        </p>
        <a href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
          border: `1px solid ${GOLD}`, color: GOLD, padding: '0.65rem 1.4rem',
          fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase',
          textDecoration: 'none', borderRadius: 999,
        }}>
          Back to HLYST →
        </a>
      </div>
    </div>
  );
}
