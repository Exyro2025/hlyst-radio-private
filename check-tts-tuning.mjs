// check-tts-tuning.mjs — READ ONLY. Prints the current live ElevenLabs
// expressiveness settings (stability/style/similarity/speaker-boost) so we
// know whether flat/robotic delivery is a real, fixable settings gap.
// Changes nothing.
//
// Run, INSIDE THE CONTROLLER CONTAINER:
//   docker exec sub-wave-controller node /app/check-tts-tuning.mjs
const PORT = 7701;
const USER = process.env.ADMIN_USER;
const PASS = process.env.ADMIN_PASS;

if (!USER || !PASS) throw new Error('ADMIN_USER/ADMIN_PASS not set in this container');
const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

async function main() {
  const res = await fetch(`http://localhost:${PORT}/settings`, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`GET /settings failed: ${res.status} ${await res.text()}`);
  const s = (await res.json()).values;
  const c = s.tts?.cloud || {};

  console.log('Cloud TTS provider:', c.provider);
  console.log('Model:', c.model);
  console.log('voiceStability:', c.voiceStability);
  console.log('voiceStyle:', c.voiceStyle);
  console.log('voiceSimilarityBoost:', c.voiceSimilarityBoost);
  console.log('voiceUseSpeakerBoost:', c.voiceUseSpeakerBoost);
  console.log('\nFull tts.cloud object:', JSON.stringify(c, null, 2));
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
