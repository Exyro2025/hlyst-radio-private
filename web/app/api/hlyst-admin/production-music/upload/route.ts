// Plain server-side upload for Production Music audio, replacing the old
// upload-token/route.ts (Vercel client-direct-upload path — see
// StorageProvider.ts for why that no longer applies off Vercel).

import { cookies } from 'next/headers';
import { storageProvider } from '@/lib/providers/StorageProvider';

async function isAuthed() {
  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

const ALLOWED_TYPES = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'];

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return Response.json({ error: 'file is required.' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return Response.json({ error: 'File must be MP3 or WAV.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const url = await storageProvider.put(`production-music/${Date.now()}-${safeName}`, buffer, file.type);

  return Response.json({ url });
}
