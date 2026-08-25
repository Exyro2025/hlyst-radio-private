import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { z } from 'zod';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

const PersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  tagline: z.string().max(80),
  soul: z.string().max(2000),
  frequency: z.enum(['rare', 'moderate', 'frequent']),
  scriptLength: z.enum(['concise', 'standard', 'extended']),
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
