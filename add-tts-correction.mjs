// add-tts-correction.mjs — script to add/update the pronunciation correction
// for "HLYST" via the existing, already-built settings.tts.corrections
// mechanism (no admin UI screen exists for this yet, but the backend fully
// supports it — there's already a built-in example rule for "SUB/WAVE").
// Fetches current settings first and only touches the one "HLYST" entry,
// leaving every other correction and every other tts setting (voice,
// provider, speed, gainDb) untouched. Safe to re-run — updates the existing
// rule's replacement text instead of duplicating or skipping it.
//
// Run, INSIDE THE CONTROLLER CONTAINER (not web):
//   docker exec sub-wave-controller node /app/add-tts-correction.mjs
const PORT = 7701;
const USER = process.env.ADMIN_USER;
const PASS = process.env.ADMIN_PASS;
const REPLACEMENT = "H'lyst"; // apostrophe, no space — hyphen still read as two words

if (!USER || !PASS) throw new Error('ADMIN_USER/ADMIN_PASS not set in this container');

const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

async function main() {
  const getRes = await fetch(`http://localhost:${PORT}/settings`, {
    headers: { Authorization: auth },
  });
  if (!getRes.ok) throw new Error(`GET /settings failed: ${getRes.status} ${await getRes.text()}`);
  const current = await getRes.json();

  const existing = Array.isArray(current?.tts?.corrections) ? current.tts.corrections : [];
  const withoutHlyst = existing.filter((c) => (c.from || '').trim().toLowerCase() !== 'hlyst');
  const newCorrections = [...withoutHlyst, { from: 'HLYST', to: REPLACEMENT }];

  const postRes = await fetch(`http://localhost:${PORT}/settings`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tts: { corrections: newCorrections } }),
  });
  if (!postRes.ok) throw new Error(`POST /settings failed: ${postRes.status} ${await postRes.text()}`);
  console.log(`Correction set: "HLYST" -> "${REPLACEMENT}". Applies live, no restart needed.`);
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
