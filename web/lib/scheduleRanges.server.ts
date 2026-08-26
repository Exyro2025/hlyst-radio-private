// Server-only. Shared by web/app/djs/page.tsx and web/app/djs/[slug]/page.tsx
// so both pages resolve schedule display text the same way, from the same
// canonical Postgres tables, rather than the static dj.schedule string in
// djs.ts.
//
// Deliberately NOT shared with web/app/schedule/page.tsx, which has its own
// copy of this same logic — that page was just fixed and confirmed working
// in production, and re-touching a freshly-verified file purely to
// deduplicate code isn't worth the redeploy risk tonight. Worth unifying
// properly in a calmer follow-up pass.

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function formatTime(t: string): string {
  const [hStr] = t.split(':');
  const h = Number(hStr);
  const h12 = h % 12 || 12;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h12}${ampm}`;
}

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

// Returns a name -> readable-ranges map, e.g.
// "Eric Jordan" -> ["Monday-Friday 2PM", "Sunday 6PM"].
// Empty map (not a thrown error) if the tables aren't reachable — callers
// fall back to showing nothing rather than crashing the page.
export async function getScheduleRangesByName(): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  try {
    const rows = (await sql`
      SELECT s.day_of_week, s.start_time, p.name
      FROM schedule s
      JOIN personas p ON p.id = s.persona_id
      WHERE p.is_imaging = false
    `) as { day_of_week: string; start_time: string; name: string }[];

    const byName = new Map<string, { dayOfWeek: string; startTime: string }[]>();
    for (const r of rows) {
      const list = byName.get(r.name) ?? [];
      list.push({ dayOfWeek: r.day_of_week, startTime: r.start_time });
      byName.set(r.name, list);
    }
    for (const [name, entries] of byName) {
      result.set(name, collapseToRanges(entries));
    }
  } catch {
    // Honest empty result — see callers for how they display this.
  }
  return result;
}
