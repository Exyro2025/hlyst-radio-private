// Admin-only preview endpoint — generates ONE test line for a persona,
// using the real system prompt (djPrompt.server.ts) and a real LLM call.
// This is text-only: no TTS, no air, nothing cached or scheduled. Matches
// the spec's "preview function that generates a test line... without
// sending it to air" — the text half of that; audio waits on ElevenLabs
// credentials.
//
// Tries ANTHROPIC_API_KEY first, then OPENAI_API_KEY. If neither is set,
// returns an honest error — never a fabricated sample line standing in
// for a real generation.

import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { buildDjSystemPrompt, type EnginePersona } from '@/lib/djPrompt.server';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

async function isAuthed() {
  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

const BREAK_PROMPTS: Record<string, string> = {
  show_open: 'Open your show. This is the first thing listeners hear from you today.',
  back_announce: 'The track that just played was a well-known song — reference it only in passing if at all, per your house rules.',
  station_id: `Give a brief station identification for ${'HLYST'}.`,
  ad_lib: 'Give a short, natural aside — nothing tied to a specific song or event, just a moment of your personality.',
};

async function callAnthropic(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API error (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
  if (!text) throw new Error('Anthropic returned no text content.');
  return text;
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI API error (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned no text content.');
  return text;
}

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

  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);

  if (!hasAnthropic && !hasOpenAI) {
    return Response.json(
      { error: 'No LLM configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY.' },
      { status: 503 }
    );
  }

  try {
    const text = hasAnthropic
      ? await callAnthropic(systemPrompt, userPrompt)
      : await callOpenAI(systemPrompt, userPrompt);
    return Response.json({ text, provider: hasAnthropic ? 'anthropic' : 'openai', systemPrompt });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Generation failed.' }, { status: 502 });
  }
}
