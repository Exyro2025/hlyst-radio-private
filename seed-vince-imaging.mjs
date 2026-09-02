// seed-vince-imaging.mjs — ONE-TIME seed script for the Vince Morgan
// Station Imaging inventory (Signature + Hype Drops + two DJ-interaction
// pieces). Safe to re-run — it replaces any prior row with the exact same
// text instead of duplicating it, so running it again after a fix (e.g. the
// HLYST pronunciation correction) regenerates all 24 with the new audio.
//
// Run:
//   docker exec sub-wave-web node /app/seed-vince-imaging.mjs
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL);
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const MODEL_ID = 'eleven_multilingual_v2';
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75, speed: 0.92 };

// Same fix as web/lib/providers/VoiceProvider.ts's forSpeech() — this script
// calls ElevenLabs directly and doesn't go through that file, so it needs
// its own copy of the same substitution or every regenerated line would
// have the old inconsistent "HLYST" pronunciation again.
function forSpeech(text) {
  return text.replace(/\bHLYST\b/gi, "H'lyst");
}

if (!ELEVEN_KEY) throw new Error('ELEVENLABS_API_KEY not set');
if (!process.env.TALKWAVE_URL_POSTGRES_URL) throw new Error('TALKWAVE_URL_POSTGRES_URL not set');

const SIGNATURE = [
  "You knew every word before the first one landed. HLYST.",
  "Funny how nobody plays that anymore. We just did. HLYST.",
  "First listen? Won't be the last. HLYST.",
  "Some records don't get old. They just get harder to find. HLYST.",
  "We don't check the year before we press play. HLYST.",
  "Go ahead. Ask somebody what station played that. HLYST.",
  "I told you to stay right here. Vince Morgan. HLYST.",
  "That's why you don't skip records you don't recognize. HLYST.",
  "You were gonna change the station. That's cute. HLYST.",
  "Still here? Yeah. We figured. HLYST.",
  "Oh, so now you remember this record. HLYST.",
  "There it is. HLYST.",
  "Yeah... they played that. HLYST.",
  "HLYST. Real DJs. Real Music. Real Culture.",
];

const HYPE_DROPS = [
  "Oh, you remember this.",
  "There it is.",
  "Don't sleep on this one.",
  "Yeah... keep that right there.",
  "I knew you'd remember.",
  "Wait for it.",
  "Now that's a record.",
  "See? That's why you're here.",
];

const BEAT_MS = 650; // pause length for a comedic "beat"
const PCM_RATE = 24000; // safer than pcm_44100, which needs ElevenLabs Pro tier

function wavHeader(dataLength, sampleRate) {
  const byteRate = sampleRate * 2;
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLength, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLength, 40);
  return buf;
}

function silence(ms) {
  const samples = Math.round((ms / 1000) * PCM_RATE);
  return Buffer.alloc(samples * 2); // zero-filled buffer = silence
}

async function synthMp3(text, voiceId) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: forSpeech(text), model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function synthPcm(text, voiceId) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_${PCM_RATE}`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
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
  // Idempotent re-run: delete any prior row with this exact text (and its
  // audio file) first, so running this script again — e.g. after a
  // pronunciation fix — REPLACES the old version instead of duplicating it.
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
  console.log('Looking up voices...');
  const vinceId = await findVoiceId('Vince Morgan');
  const nicoleId = await findVoiceId('Nicole James');
  const ericId = await findVoiceId('Eric Jordan'); // chosen for the generic "DJ" line

  console.log(`Seeding ${SIGNATURE.length} signature lines...`);
  for (const text of SIGNATURE) {
    const mp3 = await synthMp3(text, vinceId);
    await insertRow('signature', text, mp3, 'mp3');
  }

  console.log(`Seeding ${HYPE_DROPS.length} hype drop lines...`);
  for (const text of HYPE_DROPS) {
    const mp3 = await synthMp3(text, vinceId);
    await insertRow('hype_drop', text, mp3, 'mp3');
  }

  console.log('Seeding Nicole-interaction bit (both lines are Vince)...');
  {
    const line1 = "Nicole said one more record.";
    const line2 = "That was four records ago.";
    const p1 = await synthPcm(line1, vinceId);
    const p2 = await synthPcm(line2, vinceId);
    const data = Buffer.concat([p1, silence(BEAT_MS), p2]);
    const wav = Buffer.concat([wavHeader(data.length, PCM_RATE), data]);
    await insertRow('signature', `${line1} [beat] ${line2}`, wav, 'wav');
  }

  console.log('Seeding general DJ-interaction bit (DJ voice: Eric Jordan)...');
  {
    const v1 = "Sixteen DJs.";
    const dj1 = "Don't start, Vince.";
    const v2 = "I didn't say anything.";
    const v3 = "HLYST.";
    const pV1 = await synthPcm(v1, vinceId);
    const pDj1 = await synthPcm(dj1, ericId);
    const pV2 = await synthPcm(v2, vinceId);
    const pV3 = await synthPcm(v3, vinceId);
    const gap = silence(350);
    const data = Buffer.concat([pV1, gap, pDj1, gap, pV2, silence(BEAT_MS), pV3]);
    const wav = Buffer.concat([wavHeader(data.length, PCM_RATE), data]);
    await insertRow('signature', `${v1} / ${dj1} / ${v2} [beat] ${v3}`, wav, 'wav');
  }

  console.log('Done — 24 imaging assets seeded, all status=approved and eligible for rotation.');
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
