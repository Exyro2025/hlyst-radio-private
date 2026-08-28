// Artwork upload for Artist Music. Deliberately NOT built for Production
// Music — per spec, production beds should never surface as though they
// were the current "now playing" item, so they have no real use for cover
// art the way an actual artist release does.
//
// Uses the simple server-side put() path, not the client-upload-token
// pattern the audio uploads use — cover images are routinely a few hundred
// KB to a couple MB, comfortably under Vercel's 4.5MB server-upload body
// limit, unlike full audio files which regularly exceed it.

import { cookies } from 'next/headers';
import { storageProvider } from '@/lib/providers/StorageProvider';

async function isAuthed() {
  const cookieStore = await cookies();
  const session = cookieStore.get('hlyst_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASS;
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 4 * 1024 * 1024; // 4MB — comfortably under the 4.5MB server-upload ceiling

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
    return Response.json({ error: 'Artwork must be JPEG, PNG, or WebP.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'Artwork must be under 4MB.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';

  const blob = await storageProvider.put(`artist-music-artwork/${Date.now()}.${ext}`, buffer, file.type);

  return Response.json({ url: blob });
}
