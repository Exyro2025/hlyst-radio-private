// adjust-tts-expressiveness.mjs — lowers ElevenLabs stability slightly and
// raises style slightly, for more natural variation and less flat/"safe"
// delivery. Touches ONLY these two fields; every other tts.cloud setting
// (voice, model, similarity boost, speaker boost, etc.) is read back
// unchanged and resent as-is, so nothing else can drift.
//
// Run, INSIDE THE CONTROLLER CONTAINER:
//   docker exec sub-wave-controller node /app/adjust-tts-expressiveness.mjs
const PORT = 7701;
const USER = process.env.ADMIN_USER;
const PASS = process.env.ADMIN_PASS;
const NEW_STABILITY = 0.35; // was 0.5 — lower = more natural variation
const NEW_STYLE = 0.45;     // was 0.32 — higher = more expressive/emotional

if (!USER || !PASS) throw new Error('ADMIN_USER/ADMIN_PASS not set in this container');
const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

async function main() {
  const getRes = await fetch(`http://localhost:${PORT}/settings`, { headers: { Authorization: auth } });
  if (!getRes.ok) throw new Error(`GET /settings failed: ${getRes.status} ${await getRes.text()}`);
  const s = (await getRes.json()).values;

  const newCloud = { ...s.tts.cloud, voiceStability: NEW_STABILITY, voiceStyle: NEW_STYLE };
  const newTts = { ...s.tts, cloud: newCloud };

  const postRes = await fetch(`http://localhost:${PORT}/settings`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tts: newTts }),
  });
  if (!postRes.ok) throw new Error(`POST /settings failed: ${postRes.status} ${await postRes.text()}`);

  console.log(`voiceStability: ${s.tts.cloud.voiceStability} -> ${NEW_STABILITY}`);
  console.log(`voiceStyle: ${s.tts.cloud.voiceStyle} -> ${NEW_STYLE}`);
  console.log('Applied live, no restart needed.');
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
