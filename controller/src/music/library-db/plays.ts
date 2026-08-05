// Play history: what actually went to air, appended by the queue.

import { requireDb } from './handle.js';
import { rowToTrack } from './rows.js';
import type { TrackRecord, TrackRow } from './types.js';

// ---------------------------------------------------------------------------
// Play history
// ---------------------------------------------------------------------------

interface PlayRecord {
  id: number;
  trackId: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  playedAt: string;
  source: string | null;       // 'ai' | 'request' | 'auto' at write time
  requestedBy: string | null;
  showId: string | null;
  showName: string | null;
}

export type PlayWrite = Omit<PlayRecord, 'id'>;

export function recordPlay(p: PlayWrite): void {
  requireDb().prepare(`
    INSERT INTO plays (track_id, title, artist, album, played_at, source, requested_by, show_id, show_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p.trackId, p.title, p.artist, p.album, p.playedAt,
    p.source, p.requestedBy, p.showId, p.showName,
  );
}

// Last time each track went to air, keyed by track id AND by the lowercased
// "title|artist" key (the same shape music/recency.ts trackKey builds, so a
// duplicate copy of an aired song shares its twin's airing history instead of
// reading as never-aired). Timestamps are epoch ms. played_at is an ISO-8601
// string with a fixed Z offset (queue stamps toISOString), so SQL MAX() —
// lexicographic on that shape — is chronological.
export interface LastAiredIndex {
  byId: Map<string, number>;
  byKey: Map<string, number>;
}

export function lastAiredIndex(): LastAiredIndex {
  const rows = requireDb().prepare(`
    SELECT track_id, title, artist, MAX(played_at) AS last_at
    FROM plays GROUP BY track_id, title, artist
  `).all() as Array<{ track_id: string | null; title: string | null; artist: string | null; last_at: string }>;
  const byId = new Map<string, number>();
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const at = Date.parse(r.last_at);
    if (!Number.isFinite(at)) continue;
    if (r.track_id) {
      const prev = byId.get(r.track_id);
      if (prev == null || at > prev) byId.set(r.track_id, at);
    }
    if (r.title) {
      const key = `${r.title.toLowerCase().trim()}|${(r.artist || '').toLowerCase().trim()}`;
      const prev = byKey.get(key);
      if (prev == null || at > prev) byKey.set(key, at);
    }
  }
  return { byId, byKey };
}

// Random sample of tracks the station has never aired, or last aired before
// the cutoff — the library's unexplored shelf. Id-level only: a duplicate copy
// whose twin aired can appear, and the caller's recency key filters catch it.
export function deepCutTracks(cutoffIso: string, limit: number): TrackRecord[] {
  const rows = requireDb().prepare(`
    SELECT t.* FROM tracks t
    LEFT JOIN (
      SELECT track_id, MAX(played_at) AS last_at
      FROM plays WHERE track_id IS NOT NULL GROUP BY track_id
    ) p ON p.track_id = t.id
    WHERE p.last_at IS NULL OR p.last_at < ?
    ORDER BY RANDOM() LIMIT ?
  `).all(cutoffIso, Math.max(1, Math.floor(limit))) as TrackRow[];
  return rows.map(rowToTrack);
}

export function listPlays(opts: { limit?: number; offset?: number } = {}): { total: number; rows: PlayRecord[] } {
  const d = requireDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const total = (d.prepare('SELECT COUNT(*) AS n FROM plays').get() as { n: number }).n;
  const rows = (d.prepare(`
    SELECT id, track_id, title, artist, album, played_at, source, requested_by, show_id, show_name
    FROM plays ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(limit, offset) as Array<{
    id: number; track_id: string | null; title: string | null; artist: string | null;
    album: string | null; played_at: string; source: string | null;
    requested_by: string | null; show_id: string | null; show_name: string | null;
  }>).map((r) => ({
    id: r.id,
    trackId: r.track_id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    playedAt: r.played_at,
    source: r.source,
    requestedBy: r.requested_by,
    showId: r.show_id,
    showName: r.show_name,
  }));
  return { total, rows };
}


