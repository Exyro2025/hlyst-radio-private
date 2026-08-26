// Server-only. Stores a rendered audio buffer in Vercel Blob and returns
// the public URL the broadcast pipeline / DJ Breaks log can play from.
// Requires a Blob store connected to this Vercel project — Vercel
// auto-provisions the credentials this needs once that store exists.
//
// Server-side put() is capped at 4.5MB per Vercel's function body limit —
// fine here, since a single DJ break (a few spoken sentences) is nowhere
// near that. Only relevant if this ever needs to handle much longer audio.

import { put } from '@vercel/blob';

export async function uploadBreakAudio(buffer: Buffer, breakId: number): Promise<string> {
  const blob = await put(`dj-breaks/${breakId}.mp3`, buffer, {
    access: 'public',
    contentType: 'audio/mpeg',
    addRandomSuffix: false,
  });
  return blob.url;
}
