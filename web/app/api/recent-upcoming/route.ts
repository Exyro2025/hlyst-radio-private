import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.CONTROLLER_INTERNAL_URL;
  if (!url) {
    return NextResponse.json({ recentPlays: [], upcoming: [] });
  }
  try {
    const res = await fetch(`${url}/recent-upcoming`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`controller returned ${res.status}`);
    const data = await res.json();
    return NextResponse.json({
      recentPlays: Array.isArray(data.recentPlays) ? data.recentPlays : [],
      upcoming: Array.isArray(data.upcoming) ? data.upcoming : [],
    });
  } catch {
    return NextResponse.json({ recentPlays: [], upcoming: [] });
  }
}
