// Parses schedule strings like "Weekend DJ · Saturdays 6PM–10PM" or
// "Weekend DJ · Saturdays 10AM–2PM, Sundays 6PM–10PM" and determines who's
// actually on air right now and who's up next — real logic, not a guess.
//
// Place this file at: web/lib/schedule.ts

import { djs, type DjProfile } from './djs';

const DAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

interface Slot {
  dj: DjProfile;
  startWeekMin: number; // minutes since Sunday 00:00
  endWeekMin: number;   // may exceed 7*1440 if it wraps past Saturday
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

function buildSlots(): Slot[] {
  const slots: Slot[] = [];
  const dayRangeRe = /(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\s+(\d{1,2}(?::\d{2})?\s*[AP]M)\s*[–-]\s*(\d{1,2}(?::\d{2})?\s*[AP]M)/gi;

  for (const dj of djs) {
    let match: RegExpExecArray | null;
    dayRangeRe.lastIndex = 0;
    while ((match = dayRangeRe.exec(dj.schedule)) !== null) {
      const dayIdx = DAY_MAP[(match[1] ?? '').toLowerCase()];
      const start = parseClock(match[2] ?? '');
      const end = parseClock(match[3] ?? '');
      const startWeekMin = dayIdx * 1440 + start.h * 60 + start.m;
      let endWeekMin = dayIdx * 1440 + end.h * 60 + end.m;
      if (endWeekMin <= startWeekMin) endWeekMin += 1440; // crosses midnight
      slots.push({ dj, startWeekMin, endWeekMin });
    }
  }
  return slots;
}

/** Who's on air right now, or the first DJ in the roster if nothing matches
 *  (e.g. a gap in the schedule) — never returns nothing. */
export function getOnAirNow(now: Date = new Date()): DjProfile {
  const slots = buildSlots();
  const nowWeekMin = now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes();
  for (const slot of slots) {
    if (nowWeekMin >= slot.startWeekMin && nowWeekMin < slot.endWeekMin) return slot.dj;
    // also check the wrapped-around-the-week case (a Saturday night show
    // whose end time technically lands early Sunday, checked against a
    // "now" that's read as being in the following week)
    if (nowWeekMin + 7 * 1440 >= slot.startWeekMin && nowWeekMin + 7 * 1440 < slot.endWeekMin) return slot.dj;
  }
  return djs[0];
}

/** The next scheduled slot after now, chronologically — for "Coming Up". */
export function getComingUp(now: Date = new Date()): { dj: DjProfile; startsAt: string } | null {
  const slots = buildSlots();
  if (slots.length === 0) return null;
  const nowWeekMin = now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes();
  const upcoming = slots
    .map(s => ({ ...s, delta: (s.startWeekMin - nowWeekMin + 7 * 1440) % (7 * 1440) }))
    .filter(s => s.delta > 0)
    .sort((a, b) => a.delta - b.delta);
  if (upcoming.length === 0) return null;
  const next = upcoming[0];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const startDay = Math.floor((next.startWeekMin % (7 * 1440)) / 1440);
  const startMin = next.startWeekMin % 1440;
  const h12 = startMin / 60 % 12 || 12;
  const ampm = Math.floor(startMin / 60) >= 12 ? 'PM' : 'AM';
  return { dj: next.dj, startsAt: `${dayNames[startDay]} ${Math.floor(h12)}${ampm}` };
}
