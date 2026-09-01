// VoiceProvider — the seam between the HLYST engine and whatever renders
// text into spoken audio. Call sites should import `voiceProvider` from
// here, never call ElevenLabs (or any TTS vendor) directly.

// "HLYST" isn't a real word, so ElevenLabs guesses its pronunciation fresh
// every time — spelling it out one way, dropping the H another, never
// consistent. This swaps in a phonetic respelling ONLY for what's sent to
// the voice engine; the text stored in the database and shown in the admin
// UI stays the real spelling "HLYST" untouched. Matches the pronunciation
// already established for this station: "H" + "lyst" (rhymes with "list").
// Word-boundary, case-insensitive — won't touch "HLYST" inside another word.
function forSpeech(text: string): string {
  return text.replace(/\bHLYST\b/gi, 'Aitch Lyst');
}

export interface VoiceProvider {
  readonly name: string;
  isConfigured(): boolean;
  synthesize(text: string, voiceId: string): Promise<Buffer>;
}

export class ElevenLabsProvider implements VoiceProvider {
  readonly name = 'elevenlabs';

  isConfigured(): boolean {
    return Boolean(process.env.ELEVENLABS_API_KEY);
  }

  async synthesize(text: string, voiceId: string): Promise<Buffer> {
    if (!this.isConfigured()) {
      throw new Error('ELEVENLABS_API_KEY not set.');
    }

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY!,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: forSpeech(text),
        model_id: 'eleven_multilingual_v2',
        // speed 1.0 = ElevenLabs default, which read too fast/rapid-fire for
        // Vince's imaging lines in practice. Range is 0.7-1.2; 0.92 is a
        // modest pull-back, not an extreme value that would risk quality.
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.92 },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ElevenLabs API error (${res.status}): ${body.slice(0, 300)}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

export const voiceProvider: VoiceProvider = new ElevenLabsProvider();
