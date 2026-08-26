import Image from 'next/image';
import Link from 'next/link';
import { djs } from '@/lib/djs';
import { getScheduleRangesByName } from '@/lib/scheduleRanges.server';

export const revalidate = 300; // 5 min — matches web/app/schedule/page.tsx

export default async function DjsPage() {
  const ranges = await getScheduleRangesByName();

  return (
    <div style={{ padding: '4rem 2rem', background: '#0a0a0a', minHeight: '100vh' }}>
      <a href="/" style={{ color: '#c9a44c', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block', marginBottom: '1.5rem' }}>
        ← Back to Home
      </a>
      <h1 style={{ color: '#fff', fontSize: '2rem', marginBottom: '2rem' }}>The Voices of HLYST</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '2rem' }}>
        {djs.map((dj) => {
          const schedule = ranges.get(dj.name);
          return (
            <Link key={dj.slug} href={`/djs/${dj.slug}`} style={{ textDecoration: 'none', color: '#fff' }}>
              <Image src={encodeURI(dj.portrait)} alt={dj.onAirName} width={300} height={300}
                style={{ objectFit: 'cover', width: '100%', aspectRatio: '1 / 1', borderRadius: 4 }} />
              <h3 style={{ margin: '0.75rem 0 0.25rem' }}>{dj.name}</h3>
              <p style={{ color: '#c9a44c', margin: 0, fontSize: '0.9rem' }}>{dj.title}</p>
              <p style={{ color: '#999', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                {schedule && schedule.length > 0 ? schedule.join(', ') : dj.schedule}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
