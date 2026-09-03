// add-first-press.mjs — creates a new show "FIRST PRESS" (dedicated
// independent/emerging-artist programming) hosted by Winslow the Cypher,
// and moves Saturday 12PM-2PM from his regular show to this new one.
// Saturday 10AM-12PM stays his regular "HLYST — Winslow the Cypher" show,
// untouched. No music-filter narrowing applied yet (mirrors the same
// "revisit once the catalog grows" approach already agreed on tonight) —
// this just gets the correct name/branding/schedule in place.
//
// Run, INSIDE THE CONTROLLER CONTAINER:
//   docker exec sub-wave-controller node /app/add-first-press.mjs
const PORT = 7701;
const USER = process.env.ADMIN_USER;
const PASS = process.env.ADMIN_PASS;
const SATURDAY = 6; // Sun=0 ... Sat=6

if (!USER || !PASS) throw new Error('ADMIN_USER/ADMIN_PASS not set in this container');
const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

async function main() {
  const getRes = await fetch(`http://localhost:${PORT}/settings`, { headers: { Authorization: auth } });
  if (!getRes.ok) throw new Error(`GET /settings failed: ${getRes.status} ${await getRes.text()}`);
  const s = (await getRes.json()).values;

  const winslow = (s.personas || []).find((p) => /winslow/i.test(p.name || ''));
  if (!winslow) throw new Error('Could not find Winslow persona.');

  const winslowShow = (s.shows || []).find((sh) => sh.personaId === winslow.id);
  if (!winslowShow) throw new Error('Could not find Winslow\'s existing show to base the new one on.');

  const alreadyExists = (s.shows || []).some((sh) => sh.name === 'FIRST PRESS');
  if (alreadyExists) {
    console.log('A show named "FIRST PRESS" already exists — not creating a duplicate. Re-run add-first-press-schedule-only if you just need the schedule fixed.');
    return;
  }

  // Clone Winslow's existing show shape (music filters, theme, etc.) so
  // nothing about how his regular show is configured gets guessed at —
  // just a new id/name for the distinct FIRST PRESS branding.
  const newShow = {
    ...winslowShow,
    id: 'hlyst_first_press',
    name: 'FIRST PRESS',
    topic: 'Dedicated independent/emerging-artist programming.',
  };

  const newShows = [...s.shows, newShow];

  // Only touch Saturday hours 12 and 13 — everything else in the schedule,
  // every other day, stays exactly as it was.
  const newSchedule = { ...s.schedule };
  newSchedule[SATURDAY] = { ...(newSchedule[SATURDAY] || {}), 12: newShow.id, 13: newShow.id };

  const postRes = await fetch(`http://localhost:${PORT}/settings`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ shows: newShows, schedule: newSchedule }),
  });
  if (!postRes.ok) throw new Error(`POST /settings failed: ${postRes.status} ${await postRes.text()}`);

  console.log('Created show "FIRST PRESS" (id: hlyst_first_press), hosted by Winslow the Cypher.');
  console.log('Saturday 12:00 and 13:00 now point to FIRST PRESS. Saturday 10:00 and 11:00 remain his regular show.');
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
