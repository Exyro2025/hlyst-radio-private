// Parses schedule strings and determines who's actually on air right now
// and who's up next. Handles single days ("Saturday"), "Weekdays"
// (Mon–Fri), "Weekends" (Sat–Sun), and arbitrary text between a day word
// and its time range (e.g. "Sunday · Gospel · 6AM–10AM").
//
// Place this file at: web/lib/schedule.ts (REPLACES the current version
// entirely)

import { djs, type DjProfile } from './djs';

const DAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];

interface Slot {
  dj: DjProfile;
  startWeekMin: number;
  endWeekMin: number;
}

function parseClock(raw: string): { h: number; m: number } {
  const match = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) return { h: 0, m: 0 };
  let h = parseInt(match[1] ?? '0', 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  const isPM = (match[3] ?? '').toUpperCase() === 'PM';
  if (h === 12) h = isPM ? 12 : 0;
  else if (isPM) h += 12;
  return { h, m };
}

const DAY_TOKEN_RE = /\b(weekdays|weekends|sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/gi;
const TIME_RANGE_RE = /(\d{1,2}(?::\d{2})?\s*[AP]M)\s*[–-]\s*(\d{1,2}(?::\d{2})?\s*[AP]M)/gi;

function dayTokenToIndices(token: string): number[] {
  const lower = token.toLowerCase();
  if (lower === 'weekdays') return WEEKDAYS;
  if (lower === 'weekends') return WEEKENDS;
  const idx = DAY_MAP[lower];
  return idx !== undefined ? [idx] : [];
}

function buildSlots(): Slot[] {
  const slots: Slot[] = [];

  for (const dj of djs) {
    const text = dj.schedule;

    const dayTokens: { indices: number[]; pos: number }[] = [];
    DAY_TOKEN_RE.lastIndex = 0;
    let dMatch: RegExpExecArray | null;
    while ((dMatch = DAY_TOKEN_RE.exec(text)) !== null) {
      dayTokens.push({ indices: dayTokenToIndices(dMatch[1] ?? ''), pos: dMatch.index });
    }

    const timeRanges: { start: string; end: string; pos: number }[] = [];
    TIME_RANGE_RE.lastIndex = 0;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = TIME_RANGE_RE.exec(text)) !== null) {
      timeRanges.push({ start: tMatch[1] ?? '', end: tMatch[2] ?? '', pos: tMatch.index });
    }

    // Pair each day token with the next time range that appears after it
    // (and before the following day token, if any) — this tolerates any
    // text in between ("· Gospel ·", "(Overnight R&B/Soul)", etc.).
    for (let i = 0; i < dayTokens.length; i++) {
      const token = dayTokens[i];
      if (!token) continue;
      const nextTokenPos = dayTokens[i + 1]?.pos ?? Infinity;
      const range = timeRanges.find(r => r.pos > token.pos && r.pos < nextTokenPos);
      if (!range) continue;

      const start = parseClock(range.start);
      const end = parseClock(range.end);

      for (const dayIdx of token.indices) {
        const startWeekMin = dayIdx * 1440 + start.h * 60 + start.m;
        let endWeekMin = dayIdx * 1440 + end.h * 60 + end.m;
        if (endWeekMin <= startWeekMin) endWeekMin += 1440;
        slots.push({ dj, startWeekMin, endWeekMin });
      }
    }
  }

  return slots;
}

/** Who's on air right now, or the first DJ in the roster if nothing matches. */
export function getOnAirNow(now: Date = new Date()): DjProfile {
  const slots = buildSlots();
  const nowWeekMin = now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes();
  for (const slot of slots) {
    if (nowWeekMin >= slot.startWeekMin && nowWeekMin < slot.endWeekMin) return slot.dj;
    if (nowWeekMin + 7 * 1440 >= slot.startWeekMin && nowWeekMin + 7 * 1440 < slot.endWeekMin) return slot.dj;
  }
  return djs[0] as DjProfile;
}

/** The next scheduled slot after now — for "Coming Up". */
export function getComingUp(now: Date = new Date()): { dj: DjProfile; startsAt: string } | null {
  const slots = buildSlots();
  if (slots.length === 0) return null;
  const nowWeekMin = now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes();
  const upcoming = slots
    .map(s => ({ ...s, delta: (s.startWeekMin - nowWeekMin + 7 * 1440) % (7 * 1440) }))
    .filter(s => s.delta > 0)
    .sort((a, b) => a.delta - b.delta);
  if (upcoming.length === 0) return null;
  const next = upcoming[0] as Slot & { delta: number };
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const startDay = Math.floor((next.startWeekMin % (7 * 1440)) / 1440);
  const startMin = next.startWeekMin % 1440;
  const h12 = startMin / 60 % 12 || 12;
  const ampm = Math.floor(startMin / 60) >= 12 ? 'PM' : 'AM';
  return { dj: next.dj, startsAt: `${dayNames[startDay] ?? 'Sun'} ${Math.floor(h12)}${ampm}` };
}
