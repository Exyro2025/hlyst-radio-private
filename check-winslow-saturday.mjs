// check-winslow-saturday.mjs — READ ONLY. Prints Winslow the Cypher's full
// Saturday schedule so we can safely add a 12PM-2PM slot without guessing
// at or overwriting anything already there. Changes nothing.
//
// Run, INSIDE THE CONTROLLER CONTAINER:
//   docker exec sub-wave-controller node /app/check-winslow-saturday.mjs
const PORT = 7701;
const USER = process.env.ADMIN_USER;
const PASS = process.env.ADMIN_PASS;
const SATURDAY = 6; // Sun=0 ... Sat=6, per controller/src/time.ts's DOW map

if (!USER || !PASS) throw new Error('ADMIN_USER/ADMIN_PASS not set in this container');
const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

async function main() {
  const res = await fetch(`http://localhost:${PORT}/settings`, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`GET /settings failed: ${res.status} ${await res.text()}`);
  const s = (await res.json()).values;
  const winslow = (s.personas || []).find((p) => /winslow/i.test(p.name || ''));
  if (!winslow) {
    console.log('Could not find a persona matching "Winslow". Personas found:');
    console.log((s.personas || []).map((p) => p.name).join(', '));
    return;
  }
  console.log(`Winslow persona id: ${winslow.id} (name: "${winslow.name}")`);

  console.log('\nFull Saturday schedule (hour: show):');
  const satRow = (s.schedule && s.schedule[SATURDAY]) || {};
  for (let hour = 0; hour < 24; hour++) {
    const showId = satRow[hour];
    if (!showId) {
      console.log(`  ${String(hour).padStart(2, '0')}:00 — (empty)`);
      continue;
    }
    const show = (s.shows || []).find((sh) => sh.id === showId);
    const showPersona = show ? (s.personas || []).find((p) => p.id === show.personaId) : null;
    console.log(`  ${String(hour).padStart(2, '0')}:00 — "${show?.name || showId}" (host: ${showPersona?.name || 'unknown'})`);
  }

  console.log('\nAll shows currently hosted by Winslow, anywhere in the week:');
  const winslowShows = (s.shows || []).filter((sh) => sh.personaId === winslow.id);
  for (const sh of winslowShows) {
    console.log(`  "${sh.name}" (id: ${sh.id})`);
  }
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
