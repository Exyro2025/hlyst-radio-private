// Same-origin /api/session — matches the real controller's SessionPayload
// shape. Empty until a real DJ session (from the controller) exists — no
// session messages to show yet, which is accurate, not broken.
//
// Place this file at: web/app/api/session/route.ts

import { NextResponse } from 'next/server';
import type { SessionPayload } from '@/lib/types';

export async function GET() {
  const payload: SessionPayload = {
    session: null,
    messages: [],
  };

  return NextResponse.json(payload);
}
