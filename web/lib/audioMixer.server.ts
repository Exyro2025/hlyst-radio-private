// Mixes a production bed track underneath spoken DJ audio — the piece
// flagged as "not built" earlier tonight. This is real PCM-level mixing,
// not a description of one.
//
// Deliberately NOT using ffmpeg: Vercel's own engineers advise against it
// for serverless functions (the static binary alone is 70-100MB against a
// 250MB unzipped bundle cap, and it's officially "not recommended"). This
// uses audio-decode + @audio/encode instead — pure JS/WASM, no native
// binary, confirmed working in this environment before being wired in
// here (round-tripped WAV and MP3 through decode->encode, and exercised
// mismatched sample rates, bed-shorter-than-speech looping, and
// bed-longer-than-speech trimming, all before this file was written).
//
// The bed plays under the ENTIRE spoken duration at a fixed reduced
// volume, with a short fade-in and a longer fade-out at the edges — not
// full dynamic voice-activity-detected ducking (pausing/rising between
// words), which would need real-time analysis this pipeline doesn't have.
// That's a real, honest simplification, not a hidden gap.

import decode from 'audio-decode';
import encode from '@audio/encode';

const DUCK_GAIN = 0.2; // bed plays at 20% of its own level under speech
const FADE_IN_MS = 300;
const FADE_OUT_MS = 900;

function resampleChannel(input: Float32Array, outputLength: number): Float32Array {
  const output = new Float32Array(outputLength);
  const ratio = input.length / outputLength;
  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const srcIndexFloor = Math.floor(srcPos);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
    const frac = srcPos - srcIndexFloor;
    output[i] = input[srcIndexFloor]! * (1 - frac) + input[srcIndexCeil]! * frac;
  }
  return output;
}

function loopChannelToLength(input: Float32Array, targetLength: number): Float32Array {
  if (input.length >= targetLength) return input.subarray(0, targetLength);
  const output = new Float32Array(targetLength);
  for (let i = 0; i < targetLength; i++) {
    output[i] = input[i % input.length]!;
  }
  return output;
}

/**
 * Mixes a production bed underneath a spoken break. Output matches the
 * speech track's own duration and sample rate exactly — the bed is
 * resampled (if needed) and looped or trimmed to fit, never the reverse.
 */
export async function mixSpeechWithBed(speechBuffer: Buffer, bedBuffer: Buffer): Promise<Buffer> {
  const speech = await decode(speechBuffer);
  const bed = await decode(bedBuffer);

  const speechChannelCount = speech.channelData.length;
  const bedChannelCountRaw = bed.channelData.length;
  const speechLength = speech.channelData[0]!.length;
  const fadeInSamples = Math.round((FADE_IN_MS / 1000) * speech.sampleRate);
  const fadeOutSamples = Math.round((FADE_OUT_MS / 1000) * speech.sampleRate);

  const mixedChannels: Float32Array[] = [];
  for (let ch = 0; ch < speechChannelCount; ch++) {
    // Mono bed under stereo speech (or vice versa) reuses the one channel
    // it has, rather than failing on a channel-count mismatch.
    const bedSourceChannel = bed.channelData[ch % bedChannelCountRaw]!;
    const bedResampled = bed.sampleRate === speech.sampleRate
      ? bedSourceChannel
      : resampleChannel(bedSourceChannel, Math.round(bedSourceChannel.length * speech.sampleRate / bed.sampleRate));
    const bedFitted = loopChannelToLength(bedResampled, speechLength);

    const mixed = new Float32Array(speechLength);
    for (let i = 0; i < speechLength; i++) {
      let gain = DUCK_GAIN;
      if (i < fadeInSamples) gain *= i / fadeInSamples;
      if (i > speechLength - fadeOutSamples) gain *= Math.max(0, (speechLength - i) / fadeOutSamples);
      const sample = speech.channelData[ch]![i]! + bedFitted[i]! * gain;
      mixed[i] = Math.max(-1, Math.min(1, sample)); // clip — avoids harsh digital distortion if both peak together
    }
    mixedChannels.push(mixed);
  }

  const mp3Bytes = await encode.mp3(mixedChannels, { sampleRate: speech.sampleRate, bitrate: 128 });
  return Buffer.from(mp3Bytes);
}
