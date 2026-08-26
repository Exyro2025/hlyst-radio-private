// DJ profile page — matches the spec: large portrait left, editorial fields
// right. Black background, gold accents, ivory type, editorial condensed
// headlines. One dynamic route serves all 15 DJs from the djs.ts data file
// for bio/portrait/slug; the schedule line now comes from the canonical
// Postgres schedule/personas tables via scheduleRanges.server.ts, falling
// back to dj.schedule (djs.ts) only if that lookup comes back empty.
//
// Place this file at: web/app/djs/[slug]/page.tsx

import { notFound } from 'next/navigation';
import Image from 'next/image';
import { djs, getDjBySlug } from '@/lib/djs';
import { getScheduleRangesByName } from '@/lib/scheduleRanges.server';

export const revalidate = 300; // 5 min — matches web/app/schedule/page.tsx

export function generateStaticParams() {
  return djs.map(dj => ({ slug: dj.slug }));
}

export default async function DjProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dj = getDjBySlug(slug);
  if (!dj) return notFound();

  const ranges = await getScheduleRangesByName();
  const schedule = ranges.get(dj.name);
  const scheduleDisplay = schedule && schedule.length > 0 ? schedule.join(', ') : dj.schedule;

  const fields: { label: string; value: string }[] = [
    { label: 'About', value: dj.about },
    { label: 'In his lane', value: dj.inHisLane },
    { label: 'On-air style', value: dj.onAirStyle },
    { label: 'The vibe', value: dj.theVibe },
    { label: 'The audience', value: dj.theAudience },
    { label: 'What he brings', value: dj.whatHeBrings },
    { label: 'Trusted for', value: dj.trustedFor },
  ];

  return (
    <div style={{ background: '#0a0a0a', color: '#f5f0e8', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '4rem 2rem', display: 'grid', gridTemplateColumns: '380px 1fr', gap: '3rem' }}>
        <div>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '3/4', background: '#1a1a1a', borderRadius: 4, overflow: 'hidden' }}>
            <Image
              src={dj.portrait}
              alt={dj.onAirName}
              fill
              style={{ objectFit: 'cover' }}
              sizes="380px"
            />
          </div>
        </div>

        <div>
          <h1 style={{
            fontSize: '3rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            margin: 0,
            textTransform: 'uppercase',
            color: '#f5f0e8',
          }}>
            {dj.name}
          </h1>
          <h2 style={{
            fontSize: '1.1rem',
            fontWeight: 400,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: '#c9a44c',
            margin: '0.25rem 0 1.5rem',
          }}>
            {dj.onAirName !== dj.name ? dj.onAirName.replace(dj.name, '').trim() : dj.title}
          </h2>

          <p style={{ fontSize: '1.1rem', color: '#c9a44c', fontStyle: 'italic', margin: '0 0 0.5rem' }}>
            {dj.title}
          </p>
          <p style={{ fontSize: '0.95rem', color: '#999', margin: '0 0 2.5rem' }}>
            {scheduleDisplay}
          </p>

          {fields.map(f => (
            <div key={f.label} style={{ marginBottom: '1.75rem' }}>
              <h3 style={{
                fontSize: '0.8rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#c9a44c',
                margin: '0 0 0.5rem',
                fontWeight: 500,
              }}>
                {f.label}
              </h3>
              <p style={{ fontSize: '1rem', lineHeight: 1.7, color: '#e8e2d5', margin: 0 }}>
                {f.value}
              </p>
            </div>
          ))}

          <blockquote style={{
            borderLeft: '2px solid #c9a44c',
            paddingLeft: '1.25rem',
            margin: '2.5rem 0 0',
            fontSize: '1.15rem',
            fontStyle: 'italic',
            color: '#f5f0e8',
          }}>
            {dj.signatureQuote}
          </blockquote>
        </div>
      </div>
    </div>
  );
}
