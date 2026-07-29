'use client';

// Client-side listener cushion (issue #1231).
//
// Icecast bursts `settings.stream.bufferSeconds` (default 22s) of
// already-broadcast audio the moment a listener connects, so a hiccup anywhere
// upstream drains that cushion instead of being audible. That works for VLC,
// Sonos and hardware receivers. It does NOT work in a browser: a plain
// `<audio src=…>` element throws the burst away and plays at the live edge,
// holding only ~2.3s no matter what the server sends.
//
// Measured on a reference stack (2026-07-29, Chrome 141, /stream.mp3):
//   • a raw HTTP client receives 22s (528000 B @192k) within ~300ms of connect
//   • `<audio src>` while PLAYING ............ 2.30s of buffer
//   • `<audio src>` while PAUSED for 30s ..... 2.25s — it never grows
//   • same element against a 64kbps mount .... 2.30s — the cap is TIME, not bytes
//   • this module (MediaSource) .............. 22s, steady
// So the cap can't be worked around by pre-buffering before play() or by
// lowering the bitrate. The only way a browser keeps the burst is to stop
// letting the element manage the download: fetch the mount ourselves and feed
// the bytes into a SourceBuffer, which has no such read-ahead cap.
//
// The depth is NOT configured here — it is whatever Icecast bursts, so the
// operator's `stream.bufferSeconds` remains the single knob and client and
// server agree by construction.
//
// Two deliberate limits:
//   • MP3 only. MSE has no Ogg support, so the optional /stream.opus mount
//     cannot be fed through a SourceBuffer. Opus listeners keep the plain
//     element (and its ~2.3s). Opus is off by default, so this is the rare path.
//   • Callers MUST handle a null return and fall back to the plain element.
//     No MediaSource (iOS Safari), a non-MP3 mount, or a CORS-blocked fetch all
//     land there, and a listener with a small cushion beats one with no audio.

/** MP3 in MSE. The only mount type we can feed — see the header note on Ogg. */
const MPEG_MIME = 'audio/mpeg';

/** Audio kept behind the playhead before eviction. Bounds memory on a session
 *  left running for hours: the SourceBuffer holds roughly cushion + this, so
 *  ~32s of MP3 (~770 KB at 192k) rather than growing without limit. */
const KEEP_BEHIND_SECONDS = 10;

/** How often to evict. Minute-scale growth, so a 30s sweep is ample. */
const EVICT_INTERVAL_MS = 30_000;

/** Cushion beyond which we assume clock drift rather than a deep burst and
 *  seek back toward the live edge. Generous: a legitimate burst is bounded by
 *  `stream.bufferSeconds`, which `settings.update()` caps at 60. */
const MAX_CUSHION_SECONDS = 75;

/** Where to land after a drift correction — deep enough to stay useful. */
const DRIFT_RESEEK_SECONDS = 20;

export interface BufferedStreamOptions {
  /** Called when the feed can no longer be sustained (body ended, network
   *  error, SourceBuffer failure). The caller should reconnect exactly as it
   *  would for an element `error` — this handle is finished either way. Never
   *  fires after detach(). */
  onFatal: () => void;
}

export interface BufferedStreamHandle {
  /** Abort the fetch and release the MediaSource. MUST be called on stop or
   *  before re-attaching: the in-flight fetch is what holds the Icecast
   *  connection open, so skipping it leaves a phantom listener on the mount. */
  detach: () => void;
}

/** Whether this URL can be fed through a SourceBuffer in this browser.
 *  False for iOS Safari (no MediaSource) and for the Ogg-Opus mount. */
export function bufferedStreamSupported(url: string): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof MediaSource === 'undefined') return false;
  try {
    if (!MediaSource.isTypeSupported(MPEG_MIME)) return false;
  } catch {
    return false;
  }
  return isMpegMount(url);
}

/** Mount sniffing by path, ignoring the `?t=`/`?auth=` query the caller adds.
 *  A URL we can't parse is treated as unsupported so we fall back rather than
 *  feed Ogg bytes into an MP3 SourceBuffer. */
function isMpegMount(url: string): boolean {
  try {
    const path = new URL(url, window.location.href).pathname.toLowerCase();
    return path.endsWith('.mp3');
  } catch {
    return false;
  }
}

/**
 * Feed `url` into `el` through a MediaSource so the Icecast connect burst
 * survives as a real playback cushion.
 *
 * The caller still owns play(): calling it immediately is correct and is what
 * produces the cushion for free. Playback begins at t=0 of the SourceBuffer —
 * the OLDEST audio in the burst — while the rest of the burst lands behind it
 * within a few hundred ms. There is no added startup delay; the listener
 * simply starts ~bufferSeconds behind the live edge, which is exactly where
 * every non-browser client already sits.
 *
 * Returns null when this browser/mount can't be fed (caller falls back to
 * setting el.src directly).
 */
export function attachBufferedStream(
  el: HTMLAudioElement,
  url: string,
  { onFatal }: BufferedStreamOptions,
): BufferedStreamHandle | null {
  if (!bufferedStreamSupported(url)) return null;

  let mediaSource: MediaSource;
  try {
    mediaSource = new MediaSource();
  } catch {
    return null;
  }

  const abort = new AbortController();
  let detached = false;
  let evictTimer: ReturnType<typeof setInterval> | null = null;
  const objectUrl = URL.createObjectURL(mediaSource);

  const detach = () => {
    if (detached) return;
    detached = true;
    if (evictTimer !== null) {
      clearInterval(evictTimer);
      evictTimer = null;
    }
    // Aborting the fetch is what actually drops the Icecast connection.
    abort.abort();
    URL.revokeObjectURL(objectUrl);
    // Leave el.src alone — the caller either overwrites it (re-attach) or
    // clears it (stop). Touching it here would race those.
  };

  // A failure after detach is just the abort unwinding; stay silent.
  const fail = () => {
    if (detached) return;
    detach();
    onFatal();
  };

  const onSourceOpen = async () => {
    if (detached) return;
    let sourceBuffer: SourceBuffer;
    try {
      sourceBuffer = mediaSource.addSourceBuffer(MPEG_MIME);
    } catch {
      fail();
      return;
    }

    // appendBuffer is asynchronous and throws if it overlaps another append,
    // so every append waits for its own updateend before the next read.
    const settled = () =>
      sourceBuffer.updating
        ? new Promise<void>(resolve => {
            sourceBuffer.addEventListener('updateend', () => resolve(), { once: true });
          })
        : Promise.resolve();

    evictTimer = setInterval(() => {
      if (detached || mediaSource.readyState !== 'open' || sourceBuffer.updating) return;
      try {
        if (sourceBuffer.buffered.length === 0) return;
        const start = sourceBuffer.buffered.start(0);
        const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
        // Drift guard: a cushion far deeper than any burst the server can be
        // configured to send means the element's clock has fallen behind the
        // stream. Seek forward rather than let the lag grow all session.
        if (end - el.currentTime > MAX_CUSHION_SECONDS) {
          el.currentTime = end - DRIFT_RESEEK_SECONDS;
        }
        const cutoff = el.currentTime - KEEP_BEHIND_SECONDS;
        if (cutoff > start) sourceBuffer.remove(start, cutoff);
      } catch {
        // A remove/seek race is benign — the next sweep retries.
      }
    }, EVICT_INTERVAL_MS);

    try {
      const response = await fetch(url, { signal: abort.signal, credentials: 'omit' });
      if (!response.ok || !response.body) {
        fail();
        return;
      }
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (detached) return;
        if (done) {
          // Icecast closed the mount (restart, eviction, station off air).
          // Treat it exactly like an element error and let the caller's
          // backoff reconnect; the buffered tail is lost, same as today.
          fail();
          return;
        }
        if (!value) continue;
        await settled();
        if (detached || mediaSource.readyState !== 'open') return;
        sourceBuffer.appendBuffer(value);
        await settled();
      }
    } catch {
      // AbortError from detach() is filtered by the `detached` guard in fail().
      fail();
    }
  };

  mediaSource.addEventListener('sourceopen', () => { void onSourceOpen(); }, { once: true });
  el.src = objectUrl;

  return { detach };
}
