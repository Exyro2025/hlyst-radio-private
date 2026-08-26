// Async Server Component — queries Postgres directly at render time, no
// client fetch needed. Schedule/personas tables are now the canonical
// source (per the decision to make Postgres authoritative for scheduling
// site-wide); djs.ts supplies only display fields (onAirName, title,
// slug) for whichever persona each row resolves to, looked up by name.
//
// Real DJs with two distinct time slots (Eric Jordan: weekdays + Sunday)
// show as two separate rows rather than being force-merged into one.

import { neon } from '@neondatabase/serverless';
import { djs } from '@/lib/djs';

export const metadata = { title: 'Schedule — HLYST Radio' };
export const revalidate = 300; // 5 min — schedule rarely changes intra-day

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function formatTime(t: string): string {
  const [hStr] = t.split(':');
  const h = Number(hStr);
  const h12 = h % 12 || 12;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h12}${ampm}`;
}

// Groups this persona's (dayOfWeek, startTime) rows into readable ranges —
// "Monday-Friday", "Saturday-Sunday", or a single day — one range per
// distinct start time, so a persona with two different time slots (like
// Eric Jordan) correctly gets two separate range strings, not one merged
// (and wrong) one.
function collapseToRanges(entries: { dayOfWeek: string; startTime: string }[]): string[] {
  const byTime = new Map<string, number[]>();
  for (const { dayOfWeek, startTime } of entries) {
    const dayIdx = DAY_ORDER.indexOf(dayOfWeek);
    if (dayIdx === -1) continue;
    const list = byTime.get(startTime) ?? [];
    list.push(dayIdx);
    byTime.set(startTime, list);
  }

  const ranges: { sortKey: number; label: string; time: string }[] = [];
  for (const [time, daysRaw] of byTime) {
    const days = [...daysRaw].sort((a, b) => a - b);
    let runStart = days[0];
    let prev = days[0];
    const flushRun = (s: number, e: number) => {
      const label = s === e ? DAY_ORDER[s] : `${DAY_ORDER[s]}-${DAY_ORDER[e]}`;
      ranges.push({ sortKey: s ?? 0, label: label ?? '', time });
    };
    for (let i = 1; i < days.length; i++) {
      const d = days[i];
      if (d === (prev ?? -99) + 1) {
        prev = d;
      } else {
        flushRun(runStart ?? 0, prev ?? 0);
        runStart = d;
        prev = d;
      }
    }
    flushRun(runStart ?? 0, prev ?? 0);
  }

  ranges.sort((a, b) => a.sortKey - b.sortKey);
  return ranges.map((r) => `${r.label} ${formatTime(r.time)}`);
}

export default async function SchedulePage() {
  let rows: { day_of_week: string; start_time: string; name: string }[] = [];
  let loadError = false;

  try {
    const result = await sql`
      SELECT s.day_of_week, s.start_time, p.name
      FROM schedule s
      JOIN personas p ON p.id = s.persona_id
      WHERE p.is_imaging = false
    `;
    rows = result as any[];
  } catch {
    loadError = true;
  }

  const byPersonaName = new Map<string, { dayOfWeek: string; startTime: string }[]>();
  for (const r of rows) {
    const list = byPersonaName.get(r.name) ?? [];
    list.push({ dayOfWeek: r.day_of_week, startTime: r.start_time });
    byPersonaName.set(r.name, list);
  }

  // Displayed in schedule order (earliest weekday slot first), not
  // alphabetically or djs.ts array order — matches how a real station
  // schedule reads.
  const entries = [...byPersonaName.entries()]
    .map(([name, slots]) => {
      const profile = djs.find((d) => d.name === name) ?? null;
      const ranges = collapseToRanges(slots);
      const earliestSort = Math.min(
        ...slots.map((s) => DAY_ORDER.indexOf(s.dayOfWeek) * 100 + Number(s.startTime.split(':')[0]))
      );
      return { name, profile, ranges, earliestSort };
    })
    .sort((a, b) => a.earliestSort - b.earliestSort);

  return (
    <div style={{ padding: '4rem 2rem', background: '#0a0a0a', minHeight: '100vh', color: '#f5f0e8' }}>
      <a href="/" style={{ color: '#c9a44c', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block', marginBottom: '1.5rem' }}>
        ← Back to Home
      </a>
      <h1 style={{ fontSize: '2rem', marginBottom: '2rem' }}>HLYST Schedule</h1>

      {loadError && (
        <p style={{ color: '#e88', marginBottom: '2rem' }}>
          Couldn't reach the schedule right now — try again shortly.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {entries.map(({ name, profile, ranges }) => (
          <a
            key={name}
            href={profile ? `/djs/${profile.slug}` : '#'}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '1.25rem 1.5rem', background: '#111', border: '1px solid #222',
              textDecoration: 'none', color: '#f5f0e8',
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: '1.05rem' }}>{profile?.onAirName ?? name}</p>
              {profile?.title && (
                <p style={{ margin: '0.2rem 0 0', color: '#c9a44c', fontSize: '0.85rem' }}>{profile.title}</p>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              {ranges.map((r) => (
                <p key={r} style={{ margin: 0, color: '#999', fontSize: '0.9rem' }}>{r}</p>
              ))}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
