// add-tts-correction.mjs — ONE-TIME script to add a pronunciation correction
// for "HLYST" via the existing, already-built settings.tts.corrections
// mechanism (no admin UI screen exists for this yet, but the backend fully
// supports it — there's already a built-in example rule for "SUB/WAVE").
// Fetches current settings first and only appends to the corrections array,
// leaving every other tts setting (voice, provider, speed, gainDb) untouched.
//
// Run once, INSIDE THE CONTROLLER CONTAINER (not web):
//   docker exec sub-wave-controller node /app/add-tts-correction.mjs
const PORT = 7701;
const USER = process.env.ADMIN_USER;
const PASS = process.env.ADMIN_PASS;

if (!USER || !PASS) throw new Error('ADMIN_USER/ADMIN_PASS not set in this container');

const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

async function main() {
  const getRes = await fetch(`http://localhost:${PORT}/settings`, {
    headers: { Authorization: auth },
  });
  if (!getRes.ok) throw new Error(`GET /settings failed: ${getRes.status} ${await getRes.text()}`);
  const current = await getRes.json();

  const existing = Array.isArray(current?.tts?.corrections) ? current.tts.corrections : [];
  const already = existing.some((c) => (c.from || '').trim().toLowerCase() === 'hlyst');
  if (already) {
    console.log('A correction for "HLYST" already exists — leaving it as-is. Current corrections:', existing);
    return;
  }

  const newCorrections = [...existing, { from: 'HLYST', to: 'Aitch Lyst' }];

  const postRes = await fetch(`http://localhost:${PORT}/settings`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tts: { corrections: newCorrections } }),
  });
  if (!postRes.ok) throw new Error(`POST /settings failed: ${postRes.status} ${await postRes.text()}`);
  console.log('Added correction: "HLYST" -> "Aitch Lyst". Applies live, no restart needed.');
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
