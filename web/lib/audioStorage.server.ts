// Thin compatibility wrapper — delegates to providers/StorageProvider.ts,
// which is where the real provider logic and portability boundary now
// lives. Kept so existing callers don't need any changes.

import { storageProvider } from './providers/StorageProvider';

export async function uploadBreakAudio(buffer: Buffer, breakId: number): Promise<string> {
  return storageProvider.put(`dj-breaks/${breakId}.mp3`, buffer, 'audio/mpeg');
}
