// Admin-only preview endpoint — generates ONE test line for a persona,
// using the real system prompt (djPrompt.server.ts) and a real LLM call.
// This is text-only: no TTS, no air, nothing cached or scheduled. Matches
// the spec's "preview function that generates a test line... without
// sending it to air" — the text half of that; audio waits on ElevenLabs
// credentials.
//
// See engine-tick/route.ts for the real decide-then-generate-then-log
// pipeline — this route is deliberately separate: always generates on
// demand regardless of timing, and never writes to the DJ Breaks log.

import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { buildDjSystemPrompt, type EnginePersona } from '@/lib/djPrompt.server';
import { callLLM } from '@/lib/llm.server';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

async function isAuthed() {
  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

const BREAK_PROMPTS: Record<string, string> = {
  show_open: 'Open your show. This is the first thing listeners hear from you today.',
  back_announce: 'The track that just played was a well-known song — reference it only in passing if at all, per your house rules.',
  station_id: 'Give a brief station identification for HLYST.',
  ad_lib: 'Give a short, natural aside — nothing tied to a specific song or event, just a moment of your personality.',
};

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { personaId, breakType } = await req.json();
  if (!personaId || typeof personaId !== 'string') {
    return Response.json({ error: 'personaId is required.' }, { status: 400 });
  }

  const rows = await sql`
    SELECT name, soul, humour, local_colour, warmth, language
    FROM personas WHERE id = ${personaId} LIMIT 1
  `;
  if (!rows.length) {
    return Response.json({ error: 'No persona found with that id.' }, { status: 404 });
  }
  const r = rows[0] as any;
  const persona: EnginePersona = {
    name: r.name,
    soul: r.soul,
    humour: r.humour,
    localColour: r.local_colour,
    warmth: r.warmth,
    language: r.language,
  };

  const systemPrompt = buildDjSystemPrompt(persona);
  const userPrompt = BREAK_PROMPTS[breakType] ?? BREAK_PROMPTS.ad_lib!;

  try {
    const { text, provider } = await callLLM(systemPrompt, userPrompt);
    return Response.json({ text, provider, systemPrompt });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Generation failed.';
    const status = message.startsWith('No LLM configured') ? 503 : 502;
    return Response.json({ error: message }, { status });
  }
}
