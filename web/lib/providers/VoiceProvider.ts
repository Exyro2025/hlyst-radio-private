// VoiceProvider — the seam between the HLYST engine and whatever renders
// text into spoken audio. Call sites should import `voiceProvider` from
// here, never call ElevenLabs (or any TTS vendor) directly.

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
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
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
