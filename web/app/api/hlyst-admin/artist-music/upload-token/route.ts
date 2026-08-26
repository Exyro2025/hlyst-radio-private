// Same client-upload pattern as production-music/upload-token — a separate
// route (not shared) so Artist Music and Production Music stay two
// genuinely distinct upload paths, matching the spec's requirement that
// the two libraries never mix operationally.

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
          pathname: 'artist-music/',
        };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(jsonResponse);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload token generation failed.';
    return Response.json({ error: message }, { status: 400 });
  }
}
