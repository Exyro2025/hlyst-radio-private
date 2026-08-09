'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { notify, errorMessage } from '../../../../lib/notify';
import { applyMarks, patchTaggedRows, useLibrary } from '../LibraryContext';
import type { LikedResponse, LikedSort, Track, UntaggedResponse } from '../types';
import { PAGE_SIZE } from '../types';

// One hook per Tracks mode. All three are CALLED unconditionally — hooks cannot
// be conditional — and `enabled` gates the fetch, exactly as the old
// `if (tab !== 'tracks' || trackMode !== …) return` effect guards did. That is
// also the shape TanStack Query's `enabled` option takes, so the follow-up PR
// converts these one for one.
//
// Each registers its own RowSource, and the three disagree about what the
// shared events mean: Needs-tags DROPS a row on a tag save, Liked DROPS one
// when its like count hits zero, Recently-added only patches.

export function useRecentTracks(enabled: boolean) {
  const { adminFetch, ready, registerRowSource } = useLibrary();
  const [rows, setRows] = useState<Track[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const r = await adminFetch('/dj/recent?limit=50');
      if (!r.ok) throw new Error(`recent failed (${r.status})`);
      const j = await r.json() as { results: Track[] };
      setRows(j.results || []);
    } catch (err) {
      notify.err(errorMessage(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [adminFetch, ready]);

  useEffect(() => {
    if (!enabled || !ready) return;
    if (rows === null) load();
  }, [enabled, ready, rows, load]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => registerRowSource('recent', {
    getRows: () => rowsRef.current || [],
    applyBlockMarks: marks => setRows(prev => applyMarks(prev, marks)),
    onTagged: ev => setRows(prev => patchTaggedRows(prev, ev)),
    onLikeChanged: () => {},
    invalidate: () => { setRows(null); },
  }), [registerRowSource]);

  return { rows, loading, reload: load };
}

export function useUntaggedTracks(enabled: boolean) {
  const { adminFetch, ready, registerRowSource } = useLibrary();
  const [rows, setRows] = useState<Track[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (from: string | null, append: boolean) => {
    if (!ready) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (from) params.set('cursor', from);
      const r = await adminFetch(`/library/untagged?${params}`);
      if (!r.ok) throw new Error(`untagged failed (${r.status})`);
      const j = await r.json() as UntaggedResponse;
      setRows(prev => (append ? [...prev, ...j.rows] : j.rows));
      setCursor(j.nextCursor);
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [adminFetch, ready]);

  useEffect(() => {
    if (!enabled || !ready) return;
    if (rows.length === 0) load(null, false);
  }, [enabled, ready, rows.length, load]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => registerRowSource('untagged', {
    getRows: () => rowsRef.current,
    applyBlockMarks: marks => setRows(prev => applyMarks(prev, marks) ?? prev),
    onTagged: ev => {
      // Newly-tagged tracks leave the untagged list; cleared ones stay put.
      if (ev.cleared) return;
      setRows(prev => prev.filter(t => !(
        t.id === ev.track.id
        || (ev.applyToAlbum && ev.track.album && t.album === ev.track.album)
      )));
    },
    onLikeChanged: () => {},
    invalidate: () => { setRows([]); setCursor(null); },
  }), [registerRowSource]);

  return { rows, loading, cursor, loadMore: () => load(cursor, true) };
}

export function useLikedTracks(enabled: boolean) {
  const { adminFetch, ready, registerRowSource } = useLibrary();
  const [rows, setRows] = useState<Track[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<LikedSort>('recent');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const sp = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        sort,
      });
      const r = await adminFetch(`/library/liked?${sp}`);
      if (!r.ok) throw new Error(`liked failed (${r.status})`);
      const j = await r.json() as LikedResponse;
      setRows(j.rows || []);
      setTotal(j.total || 0);
    } catch (err) {
      notify.err(errorMessage(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [adminFetch, ready, page, sort]);

  useEffect(() => {
    if (!enabled || !ready) return;
    load();
  }, [enabled, ready, load]);

  // Reset paging on sort, or a page-3 view survives into a shorter list.
  useEffect(() => { setPage(0); }, [sort]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => registerRowSource('liked', {
    getRows: () => rowsRef.current || [],
    applyBlockMarks: marks => setRows(prev => applyMarks(prev, marks)),
    onTagged: ev => setRows(prev => patchTaggedRows(prev, ev)),
    onLikeChanged: (songId, next) => {
      if (next) {
        setRows(prev => prev && prev.map(t => (t.id === songId
          ? { ...t, likeCount: next.count, likedByOperator: next.operator } : t)));
        return;
      }
      // A track nobody likes any more is no longer in this list.
      setRows(prev => prev && prev.filter(t => t.id !== songId));
      setTotal(n => Math.max(0, n - 1));
    },
    // Refetches rather than clearing: the load effect keys on the page/sort,
    // not on rows being null, so a bare clear would leave the list blank.
    invalidate: () => { void loadRef.current(); },
  }), [registerRowSource]);

  return { rows, total, loading, page, setPage, sort, setSort, reload: load };
}
