// Public, unauthenticated — this is the canonical "who's on air" resolver
// for the whole site now. Postgres schedule + personas are the source of
// truth for WHICH persona is on; djs.ts is used only to look up that
// persona's rich display fields (portrait, bio, slug) by name, per the
// decision to keep djs.ts as fallback/display data, not as the runtime
// scheduling authority.
//
// Never returns a fabricated fallback DJ — if nothing resolves (tables
// empty, a DB error, a name that doesn't match anything in djs.ts), the
// response is honestly null and callers show an empty/loading state
// rather than an invented identity.

import { neon } from '@neondatabase/serverless';
import { djs, type DjProfile } from '@/lib/djs';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

const SLOT_STARTS = [2, 6, 10, 14, 18, 22];
const STATION_TIMEZONE = 'America/New_York';
const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function resolveCurrentSlot(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STATION_TIMEZONE,
    weekday: 'long',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const dayOfWeek = parts.find((p) => p.type === 'weekday')!.value;
  let hour = Number(parts.find((p) => p.type === 'hour')!.value);
  if (hour === 24) hour = 0; // ICU midnight quirk

  const FIRST_SLOT_START = 2; // matches SLOT_STARTS[0] — spelled out to avoid
  // strict TypeScript flagging bracket access as possibly undefined.
  let blockHour = hour < FIRST_SLOT_START ? 22 : FIRST_SLOT_START;
  for (const s of SLOT_STARTS) if (hour >= s) blockHour = s;

  return { dayIndex: DAY_ORDER.indexOf(dayOfWeek), startTime: `${String(blockHour).padStart(2, '0')}:00` };
}

function findProfile(name: string): DjProfile | null {
  return djs.find((d) => d.name === name) ?? null;
}

export async function GET() {
  try {
    const rows = await sql`
      SELECT s.day_of_week, s.start_time, p.name
      FROM schedule s
      JOIN personas p ON p.id = s.persona_id
      WHERE p.is_imaging = false
    `;

    const all = (rows as any[])
      .map((r) => ({
        dayIndex: DAY_ORDER.indexOf(r.day_of_week as string),
        startTime: r.start_time as string,
        name: r.name as string,
      }))
      .sort((a, b) => a.dayIndex - b.dayIndex || a.startTime.localeCompare(b.startTime));

    if (all.length === 0) {
      return Response.json({ onAir: null, comingUp: null });
    }

    const cur = resolveCurrentSlot(new Date());
    const curIdx = all.findIndex((r) => r.dayIndex === cur.dayIndex && r.startTime === cur.startTime);

    if (curIdx === -1) {
      return Response.json({ onAir: null, comingUp: null });
    }

    const curRow = all[curIdx]!;
    const nextRow = all[(curIdx + 1) % all.length]!;

    const onAirProfile = findProfile(curRow.name);
    const nextProfile = findProfile(nextRow.name);

    const [h] = nextRow.startTime.split(':').map(Number);
    const h12 = (h as number) % 12 || 12;
    const ampm = (h as number) >= 12 ? 'PM' : 'AM';
    const startsAt = `${DAY_ABBR[nextRow.dayIndex] ?? '???'} ${h12}${ampm}`;

    return Response.json({
      onAir: onAirProfile,
      comingUp: nextProfile ? { dj: nextProfile, startsAt } : null,
    });
  } catch {
    // Schedule/personas tables not reachable — honest null, not a fake DJ.
    return Response.json({ onAir: null, comingUp: null });
  }
}
