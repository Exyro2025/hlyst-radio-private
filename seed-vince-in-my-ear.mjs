// seed-vince-in-my-ear.mjs — adds Vince Morgan's 4 new IN MY EAR lines
// (VM-IME-001 through 004) to the existing Station Imaging system. Uses the
// SAME render/storage/table as the earlier Signature/Hype Drop seed — just
// a new batch, tagged imaging_type='in_my_ear' to match the Talk Wave -> In
// My Ear rename. Safe to re-run: replaces any prior row with the exact same
// text instead of duplicating it.
//
// Run:
//   docker exec sub-wave-web node /app/seed-vince-in-my-ear.mjs
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL);
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const MODEL_ID = 'eleven_multilingual_v2';
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75, speed: 0.92 };

function forSpeech(text) {
  return text.replace(/\bHLYST\b/gi, "H'lyst");
}

if (!ELEVEN_KEY) throw new Error('ELEVENLABS_API_KEY not set');
if (!process.env.TALKWAVE_URL_POSTGRES_URL) throw new Error('TALKWAVE_URL_POSTGRES_URL not set');

const IN_MY_EAR = [
  "The DJ said what they said. You disagree? Beautiful. In My Ear. HLYST.",
  "Go ahead. Get in their ear. HLYST.",
  "Some of y'all send messages. Some of y'all send dissertations. We read both. In My Ear.",
  "Some thoughts should stay in your head. We're betting this isn't one of them. In My Ear. HLYST.",
];

async function synthMp3(text, voiceId) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: forSpeech(text), model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function findVoiceId(nameLike) {
  const rows = await sql`SELECT id, name, tts_voice_id FROM personas WHERE name ILIKE ${'%' + nameLike + '%'} LIMIT 1`;
  if (!rows.length || !rows[0].tts_voice_id) {
    throw new Error(`No persona found matching "${nameLike}" with a tts_voice_id set.`);
  }
  console.log(`  matched "${nameLike}" -> ${rows[0].name} (${rows[0].tts_voice_id})`);
  return rows[0].tts_voice_id;
}

const fs = await import('node:fs/promises');
const uploadDir = '/app/public/uploads/vm-imaging';
await fs.mkdir(uploadDir, { recursive: true });

async function insertRow(imagingType, text, buffer, ext) {
  const prior = await sql`SELECT id, audio_url FROM vm_imaging WHERE text = ${text}`;
  for (const row of prior) {
    if (row.audio_url) {
      const priorFilename = String(row.audio_url).split('/').pop();
      if (priorFilename) await fs.unlink(`${uploadDir}/${priorFilename}`).catch(() => {});
    }
    await sql`DELETE FROM vm_imaging WHERE id = ${row.id}`;
  }
  const filename = `${imagingType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await fs.writeFile(`${uploadDir}/${filename}`, buffer);
  const audioUrl = `${SITE_URL}/uploads/vm-imaging/${filename}`;
  await sql`
    INSERT INTO vm_imaging (imaging_type, text, audio_url, audio_status, status)
    VALUES (${imagingType}, ${text}, ${audioUrl}, 'rendered', 'approved')
  `;
  console.log(`  ok [${imagingType}] "${text.slice(0, 60)}"`);
}

async function main() {
  console.log('Looking up Vince Morgan voice...');
  const vinceId = await findVoiceId('Vince Morgan');

  console.log(`Seeding ${IN_MY_EAR.length} In My Ear lines...`);
  for (const text of IN_MY_EAR) {
    const mp3 = await synthMp3(text, vinceId);
    await insertRow('in_my_ear', text, mp3, 'mp3');
  }

  console.log('Done — 4 In My Ear imaging assets seeded, all status=approved and eligible for rotation.');
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
