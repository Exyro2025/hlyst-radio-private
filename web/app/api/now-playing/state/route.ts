// Same-origin /api/state — matches the real controller's StationState shape.
// Empty queue/history/log until the real controller exists; this is honest,
// not a bug — there's no DJ queue to report yet.
//
// Place this file at: web/app/api/state/route.ts

import { NextResponse } from 'next/server';
import type { StationState } from '@/lib/types';

export async function GET() {
  const payload: StationState = {
    upcoming: [],
    history: [],
    djLog: [],
    timezone: 'America/New_York',
    locale: 'en-US',
    ui: { boothBuddy: false, skin: 'classic', tuneInOverlay: true },
    privacy: { privatePlayer: false, listenerAuth: false },
    station: { id: 'hlyst', name: 'HLYST Radio', multiStation: false },
  };

  return NextResponse.json(payload);
}
