import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { z } from 'zod';

// Forces dynamic rendering — this route hits the DB at module load
// (const sql = neon(...)) and must never be statically evaluated at
// Docker build time, when TALKWAVE_URL_POSTGRES_URL isn't set.
export const dynamic = 'force-dynamic';


const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

const PersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  tagline: z.string().max(80),
  soul: z.string().max(2000),
  frequency: z.enum(['silent', 'quiet', 'moderate', 'chatty', 'aggressive']),
  scriptLength: z.enum(['one-liner', 'concise', 'extended', 'storyteller']),
  djMode: z.boolean(),
  humour: z.number().int().min(0).max(10),
  localColour: z.number().int().min(0).max(10),
  warmth: z.number().int().min(0).max(10),
  language: z.string().max(60),
  avatar: z.string(),
  ttsEngine: z.string(),
  ttsVoiceId: z.string(),
  ttsGainDb: z.number(),
  ttsSpeed: z.number(),
  isImaging: z.boolean(),
  enabled: z.boolean(),
});

async function isAuthed() {
  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rows = await sql`SELECT * FROM personas ORDER BY is_imaging ASC, name ASC`;
  return Response.json({ personas: rows });
}

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const parsed = PersonaSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: 'Invalid persona.', issues: parsed.error.issues }, { status: 400 });
  }
  const p = parsed.data;
  await sql`
    UPDATE personas SET
      name = ${p.name}, tagline = ${p.tagline}, soul = ${p.soul},
      frequency = ${p.frequency}, script_length = ${p.scriptLength}, dj_mode = ${p.djMode},
      humour = ${p.humour}, local_colour = ${p.localColour}, warmth = ${p.warmth},
      language = ${p.language}, avatar = ${p.avatar},
      tts_engine = ${p.ttsEngine}, tts_voice_id = ${p.ttsVoiceId},
      tts_gain_db = ${p.ttsGainDb}, tts_speed = ${p.ttsSpeed},
      is_imaging = ${p.isImaging}, enabled = ${p.enabled},
      updated_at = now()
    WHERE id = ${p.id}
  `;
  return Response.json({ ok: true });
}
