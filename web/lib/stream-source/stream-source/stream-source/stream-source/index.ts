// The ONE place that decides which stream source is active. Every page and
// component that needs Now Playing data imports getActiveStreamSource() from
// HERE — never Live365Source or HlystControllerSource directly.
//
// Switching from Live365 to the HLYST controller later is a ONE-LINE change:
// flip the STREAM_SOURCE environment variable in Vercel. No component, no
// player code, no page needs to change.
//
// Place this file at: web/lib/stream-source/index.ts

import type { StreamSource } from './types';
import { Live365Source } from './live365-source';
import { HlystControllerSource } from './hlyst-controller-source';

export type { StreamSource, StreamSourceData } from './types';

// Set in Vercel env vars: STREAM_SOURCE=live365 (now) or
// STREAM_SOURCE=hlyst-controller (later, once the host is deployed).
const SOURCE = process.env.STREAM_SOURCE || 'live365';

let _source: StreamSource | null = null;

export function getActiveStreamSource(): StreamSource {
  if (_source) return _source;
  _source = SOURCE === 'hlyst-controller'
    ? new HlystControllerSource()
    : new Live365Source();
  return _source;
}
