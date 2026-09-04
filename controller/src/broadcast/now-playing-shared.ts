// Shared shape the HLYST player reads, no matter whether a song is playing
// or a Talk Wave segment is live. This is the ONE type the frontend Now
// Playing component should consume — it never needs to know which system
// produced it.
//
// Place this file at: controller/src/broadcast/now-playing-shared.ts
// (or wherever your other shared broadcast types live)

export interface NowPlaying {
  blockType: 'music' | 'talk';
  isLive: true;

  currentDj: { id: string; name: string } | null;
  currentShow: { id?: string; name?: string; topic?: string } | null;

  // Populated only when blockType === 'music'
  track: {
    title: string;
    artist: string | null;
    album: string | null;
    sourceTrackId: string | null;
    startedAt: string | null;
  } | null;

  // Populated only when blockType === 'talk'
  talk: {
    segmentStatus: string;
    guest: { name: string; role?: string } | null;
    artwork: string | null;
    streamUrl?: string | null;
  } | null;
}

// The shape we expect Talk Wave to POST to us. Adjust field names once you
// confirm what Talk Wave actually sends — this is a reasonable starting
// guess based on the fields you listed as needed (segment status, host/show,
// guest info, schedule, stream URL, artwork).
export interface TalkWaveWebhookPayload {
  event: 'segment.start' | 'segment.end' | string;
  t: string; // ISO timestamp
  host?: { id: string; name: string } | null;
  show?: { id: string; name: string } | null;
  segmentStatus: string;
  guest?: { name: string; role?: string } | null;
  artwork?: string | null;
  streamUrl?: string | null;
}
