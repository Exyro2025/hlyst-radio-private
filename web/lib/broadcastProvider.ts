// BroadcastProvider — the seam between the HLYST UI and whatever service
// actually delivers the stream. The player, now-playing route, and Control
// Room's Engine Health screen should all talk to THIS interface, never to
// Live365 (or any future provider) directly. That's the whole point: swapping
// delivery providers later should never require touching UI or engine code.
//
// Today's only implementation is Live365Provider, below.
//
// IMPORTANT — read before wiring this into real metadata fetching:
// Live365 does not currently publish a documented, authenticated broadcaster
// API for pulling now-playing metadata (artist/title/DJ) programmatically.
// Their sanctioned integration path is the embeddable player/last-played
// IFRAME widget (https://live365.com/embed/player.html?station=<id>), and
// third parties who've tried reading the JSON their own widgets use report
// CORS blocking that requires a server-side proxy — with no guarantee that
// endpoint is stable or intended for external use. An open feature request
// for a real broadcaster API has been pending since 2019.
//
// That means Live365Provider below is honest-but-incomplete BY NECESSITY,
// not by oversight: it correctly reports configured/not-configured and
// exposes the real stream URL (which Live365 does document), but
// getStatus()'s nowPlaying/dj/currentShow fields stay null until one of
// these is actually decided and built:
//   (a) embed Live365's own widget for metadata display (loses custom UI),
//   (b) build a server-side proxy against Live365's own undocumented
//       per-station JSON feed once real station credentials exist to test
//       against (fragile — can break without notice), or
//   (c) ask Live365 support whether the account's plan tier includes any
//       API access beyond the public widgets.
// Do not guess at an endpoint shape here without real credentials to verify
// it against — a fabricated integration that silently returns nothing is
// worse than an honest "not yet built" gap.

export interface BroadcastTrack {
  artist: string;
  title: string;
  playedAt: string; // ISO timestamp
}

export interface BroadcastStatus {
  connected: boolean;
  configState: 'configured' | 'not_configured';
  streamUrl: string | null;
  artist: string | null;
  title: string | null;
  artwork: string | null;
  currentShow: string | null;
  currentDj: string | null;
  recentTracks: BroadcastTrack[];
  reason?: string;
}

export interface BroadcastOutputAdapter {
  publish(
    audio: { url: string; durationSeconds: number },
    metadata: { artist?: string; title?: string; djPersonaId?: string; showName?: string }
  ): Promise<{ success: boolean; error?: string }>;
  getStatus(): Promise<BroadcastStatus>;
}

const LIVE365_STATION_ID = process.env.LIVE365_STATION_ID || '';
const LIVE365_STREAM_URL = process.env.LIVE365_STREAM_URL || process.env.NEXT_PUBLIC_STREAM_URL || '';
const LIVE365_API_CREDENTIAL = process.env.LIVE365_API_CREDENTIAL || '';

function isConfigured(): boolean {
  return Boolean(LIVE365_STATION_ID && LIVE365_STREAM_URL);
}

export class Live365Provider implements BroadcastOutputAdapter {
  async getStatus(): Promise<BroadcastStatus> {
    if (!isConfigured()) {
      return {
        connected: false,
        configState: 'not_configured',
        streamUrl: null,
        artist: null,
        title: null,
        artwork: null,
        currentShow: null,
        currentDj: null,
        recentTracks: [],
        reason: 'LIVE365_STATION_ID and/or LIVE365_STREAM_URL are not set.',
      };
    }
    return {
      connected: true,
      configState: 'configured',
      streamUrl: LIVE365_STREAM_URL,
      artist: null,
      title: null,
      artwork: null,
      currentShow: null,
      currentDj: null,
      recentTracks: [],
      reason: 'Live365 metadata integration not yet built — see broadcastProvider.ts header.',
    };
  }

  async publish(
    _audio: { url: string; durationSeconds: number },
    _metadata: { artist?: string; title?: string; djPersonaId?: string; showName?: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isConfigured()) {
      return { success: false, error: 'Live365 not configured — see LIVE365_STATION_ID / LIVE365_STREAM_URL.' };
    }
    return { success: false, error: 'Live365 publish path not yet implemented — awaiting account capability decision.' };
  }
}

// SubwaveProvider — reads real now-playing metadata (artist/title/DJ/show/
// stream health) straight from SUB/WAVE's own controller, which already
// serves exactly this shape at GET /now-playing (controller/src/routes/
// public.ts). This is the "internal metadata" half of the contract: the
// actual public streamUrl listeners connect to is still Live365's job, kept
// deliberately out of scope here — see the header note and Section 11 of
// the completion pass. Falls back honestly to Live365Provider's existing
// (currently metadata-blank) behavior when SUB/WAVE isn't configured, so
// this never silently regresses a station that hasn't deployed SUB/WAVE yet.
export class SubwaveProvider implements BroadcastOutputAdapter {
  private fallback = new Live365Provider();

  async getStatus(): Promise<BroadcastStatus> {
    const url = process.env.SUBWAVE_CONTROLLER_URL;
    if (!url) return this.fallback.getStatus();

    try {
      const res = await fetch(`${url}/now-playing`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`SUB/WAVE now-playing returned ${res.status}`);
      const data = await res.json();
      return {
        connected: !!data.streamOnline,
        configState: 'configured',
        // The public listen URL is Live365's job once that's connected —
        // this provider is metadata-only by design.
        streamUrl: null,
        artist: data.nowPlaying?.artist ?? null,
        title: data.nowPlaying?.title ?? null,
        artwork: null,
        currentShow: data.activeShow?.name ?? null,
        currentDj: data.dj?.name ?? null,
        recentTracks: [],
      };
    } catch (err) {
      return {
        connected: false,
        configState: 'configured',
        streamUrl: null,
        artist: null,
        title: null,
        artwork: null,
        currentShow: null,
        currentDj: null,
        recentTracks: [],
        reason: err instanceof Error ? err.message : 'SUB/WAVE now-playing fetch failed.',
      };
    }
  }

  async publish(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'SubwaveProvider is metadata-only — publish() has no meaning here.' };
  }
}

export const broadcastProvider: BroadcastOutputAdapter = process.env.SUBWAVE_CONTROLLER_URL
  ? new SubwaveProvider()
  : new Live365Provider();
