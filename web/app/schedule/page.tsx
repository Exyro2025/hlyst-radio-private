import { djs } from '@/lib/djs';

export const metadata = { title: 'Schedule — HLYST Radio' };

export default function SchedulePage() {
  return (
    <div style={{ padding: '4rem 2rem', background: '#0a0a0a', minHeight: '100vh', color: '#f5f0e8' }}>
      <a href="/" style={{ color: '#c9a44c', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block', marginBottom: '1.5rem' }}>
        ← Back to Home
      </a>
      <h1 style={{ fontSize: '2rem', marginBottom: '2rem' }}>HLYST Schedule</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {djs.map((dj) => (
          <a
            key={dj.slug}
            href={`/djs/${dj.slug}`}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '1.25rem 1.5rem', background: '#111', border: '1px solid #222',
              textDecoration: 'none', color: '#f5f0e8',
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: '1.05rem' }}>{dj.onAirName}</p>
              <p style={{ margin: '0.2rem 0 0', color: '#c9a44c', fontSize: '0.85rem' }}>{dj.title}</p>
            </div>
            <p style={{ margin: 0, color: '#999', fontSize: '0.9rem', textAlign: 'right' }}>{dj.schedule}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
