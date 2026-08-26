// Client-upload token route. Production/artist audio files can easily
// exceed Vercel's 4.5MB server-upload body limit, so this uses the
// direct-to-Blob client upload path (@vercel/blob/client) instead of the
// simple put() used for short TTS clips elsewhere in this codebase — a
// genuinely different upload mechanism, not a copy of the DJ audio path.

import { cookies } from 'next/headers';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

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
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'],
          addRandomSuffix: true,
          pathname: 'production-music/',
        };
      },
      onUploadCompleted: async () => {
        // Intentionally empty: metadata is extracted client-side before
        // upload (see the admin page), and saved via a separate explicit
        // POST to /api/hlyst-admin/production-music once the owner has
        // reviewed/corrected the detected fields — not auto-inserted the
        // instant the file lands in Blob.
      },
    });
    return Response.json(jsonResponse);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload token generation failed.';
    return Response.json({ error: message }, { status: 400 });
  }
}
