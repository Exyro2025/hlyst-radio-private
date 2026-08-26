// Thin compatibility wrapper — delegates to providers/VoiceProvider.ts,
// which is where the real provider logic and portability boundary now
// lives. Kept so existing callers don't need any changes.

import { voiceProvider } from './providers/VoiceProvider';

export async function synthesizeSpeech(text: string, voiceId: string): Promise<Buffer> {
  return voiceProvider.synthesize(text, voiceId);
}
