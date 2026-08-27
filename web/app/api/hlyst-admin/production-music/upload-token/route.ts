// Client-upload token route. Production/artist audio files can easily
// exceed Vercel's 4.5MB server-upload body limit, so this uses the
// direct-to-Blob client upload path via storageProvider (not the simple
// put() used for short TTS clips elsewhere in this codebase).

import { cookies } from 'next/headers';
import type { HandleUploadBody } from '@vercel/blob/client';
import { storageProvider } from '@/lib/providers/StorageProvider';

async function isAuthed() {
  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await storageProvider.createClientUploadToken({
      body,
      request,
      pathname: 'production-music/',
      allowedContentTypes: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'],
    });
    return Response.json(jsonResponse);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload token generation failed.';
    return Response.json({ error: message }, { status: 400 });
  }
}
