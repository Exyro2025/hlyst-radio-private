// Generates ONE new evergreen VM imaging asset — text + audio — and saves
// it as a draft in vm_imaging. This is deliberately NOT the same pipeline
// as engine-tick's dynamic DJ breaks: VM imaging is meant to be generated
// once, reviewed, approved, and reused many times (spec section 7), not
// regenerated on every play. Nothing here marks anything "approved"
// automatically — that's a separate, explicit admin action.

import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { buildDjSystemPrompt, type EnginePersona } from '@/lib/djPrompt.server';
import { callLLM } from '@/lib/llm.server';
import { voiceProvider } from '@/lib/providers/VoiceProvider';
import { storageProvider } from '@/lib/providers/StorageProvider';

// Forces dynamic rendering — this route hits the DB at module load
// (const sql = neon(...)) and must never be statically evaluated at
// Docker build time, when TALKWAVE_URL_POSTGRES_URL isn't set.
export const dynamic = 'force-dynamic';


const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

async function isAuthed() {
  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

const IMAGING_PROMPTS: Record<string, string> = {
  station_id: 'Give a brief, confident HLYST station identification.',
  show_transition: 'Announce a transition between two shows on HLYST — you don\'t know the specific DJs, so keep it generic enough to work for any handoff.',
  talkwave_invite: 'Invite listeners to send in a message or voice note through Talk Wave.',
  special_announcement: 'Make a general-purpose special announcement for HLYST — something that could apply to a variety of station news, without inventing specific fake news.',
  programming_notice: 'Give a brief heads-up about upcoming HLYST programming — generic enough to work without inventing a specific fake show or time.',
  the_lyst_intro: 'Introduce "The Lyst," an HLYST programming segment, briefly and confidently.',
  interview_intro: 'Introduce an upcoming interview segment on HLYST — generic enough to work without inventing a specific fake guest.',
};

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { imagingType } = await req.json();
  if (!imagingType || !(imagingType in IMAGING_PROMPTS)) {
    return Response.json({ error: `imagingType must be one of: ${Object.keys(IMAGING_PROMPTS).join(', ')}` }, { status: 400 });
  }

  const rows = await sql`
    SELECT name, soul, humour, local_colour, warmth, language, tts_voice_id
    FROM personas WHERE id = 'vince_morgan_vm' LIMIT 1
  `;
  if (!rows.length) {
    return Response.json({ error: 'Vince Morgan (VM) persona not found in the database.' }, { status: 404 });
  }
  const r = rows[0] as any;
  const persona: EnginePersona = {
    name: r.name, soul: r.soul, humour: r.humour, localColour: r.local_colour, warmth: r.warmth, language: r.language,
  };

  const systemPrompt = buildDjSystemPrompt(persona);
  const userPrompt = IMAGING_PROMPTS[imagingType]!; // presence already checked above

  try {
    const { text } = await callLLM(systemPrompt, userPrompt);

    const insertRows = await sql`
      INSERT INTO vm_imaging (imaging_type, text, status)
      VALUES (${imagingType}, ${text}, 'draft')
      RETURNING id
    `;
    const newId = (insertRows[0] as any).id;

    if (r.tts_voice_id && voiceProvider.isConfigured()) {
      try {
        const audioBuffer = await voiceProvider.synthesize(text, r.tts_voice_id);
        const audioUrl = await storageProvider.put(`vm-imaging/${newId}.mp3`, audioBuffer, 'audio/mpeg');
        await sql`UPDATE vm_imaging SET audio_url = ${audioUrl}, audio_status = 'rendered' WHERE id = ${newId}`;
      } catch {
        await sql`UPDATE vm_imaging SET audio_status = 'failed' WHERE id = ${newId}`;
      }
    }

    return Response.json({ id: newId, text, imagingType });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Generation failed.';
    return Response.json({ error: message }, { status: 502 });
  }
}
