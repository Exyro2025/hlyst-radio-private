'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { notify, errorMessage } from '../../../lib/notify';
import type { PlaylistSummary } from '../LibraryPlaylistsTab';
import type { Coverage } from '../LibraryTaggingPanel';
import type {
  BlockEntry, BlockRef, BlockType, BrowseResponse,
  LikeIndex, RowSource, TagEvent, Track,
} from './types';

// Per-call cap on POST /library/blocklist/check, matching the controller's.
// A Search tab paged deep with Load more can hold more rows than that.
const CHECK_CHUNK = 500;

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;

// The Blocked tab owns the entry LIST, but blocking happens from any tab (and
// the block toast's Undo fires from wherever it was raised), so the actions
// live here and reach the list through this sink. Same seam as RowSource.
export interface BlockListSink {
  add(entry: BlockEntry): void;
  remove(type: BlockType, id: string): void;
}

export interface LibraryShared {
  // The ONE useAdminAuth instance for the whole library page, passed down
  // rather than re-created per tab: useAdminAuth is a per-instance hook
  // holding its own hydration state, so N callers race N hydrations and an
  // unauthenticated first request can wipe a sibling's token
  // (see lib/adminAuth.ts:80).
  adminFetch: AdminFetch;
  ready: boolean;

  coverage: Coverage | null;
  reloadCoverage: () => Promise<void>;

  // Register a loaded row list for the duration of a tab's mount. Returns the
  // unregister function — return it straight from useEffect.
  registerRowSource: (key: string, src: RowSource) => () => void;
  registerBlockList: (sink: BlockListSink) => () => void;
  // Re-stamp blockedBy across every registered list.
  restampBlockMarks: () => Promise<void>;
  // Drop and refetch every registered list.
  invalidateAllRows: () => void;

  likeIndex: LikeIndex;
  liking: string | null;
  toggleLike: (track: Track, isLiked: boolean) => Promise<void>;
  clearLikes: (track: Track) => Promise<void>;

  selected: Set<string>;
  toggleSelect: (id: string) => void;
  toggleAllRows: (rows: Track[]) => void;
  clearSelection: () => void;
  playlists: PlaylistSummary[] | null;
  plBusy: boolean;
  addSelectedToPlaylist: (t: { playlistId?: string; name?: string }) => Promise<void>;

  // Mood vocabulary for the inline editor. Only the browse response carries
  // it, so other tabs trigger a one-row browse rather than bundling the list.
  vocab: string[];
  seedVocab: (v: string[]) => void;
  ensureVocab: () => Promise<void>;

  queuing: string | null;
  retagging: string | null;
  flashId: string | null;
  editingId: string | null;
  manualBusy: string | null;
  blocking: string | null;
  queueTrack: (t: Track) => Promise<void>;
  retagTrack: (t: Track) => Promise<void>;
  onEditTrack: (t: Track) => void;
  cancelEdit: () => void;
  saveManualTag: (
    t: Track, moods: string[], energy: string | null, applyToAlbum: boolean,
  ) => Promise<void>;
  blockTrack: (t: Track, type: BlockType) => Promise<void>;
  unblockRow: (t: Track, ref: BlockRef) => Promise<void>;
  removeBlockEntry: (
    e: { type: BlockType; id: string; name?: string | null },
    opts?: { quiet?: boolean },
  ) => Promise<void>;
}

const Ctx = createContext<LibraryShared | null>(null);

export function useLibrary(): LibraryShared {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLibrary must be used inside <LibraryProvider>');
  return v;
}

export function LibraryProvider({
  adminFetch, ready, coverage, reloadCoverage, children,
}: {
  adminFetch: AdminFetch;
  ready: boolean;
  coverage: Coverage | null;
  reloadCoverage: () => Promise<void>;
  children: ReactNode;
}) {
  // --- row-source registry -------------------------------------------------
  // A ref, not state: registering must not re-render the provider, or every
  // tab mount would re-render the whole page.
  const sourcesRef = useRef(new Map<string, RowSource>());
  const registerRowSource = useCallback((key: string, src: RowSource) => {
    sourcesRef.current.set(key, src);
    return () => { sourcesRef.current.delete(key); };
  }, []);
  const eachSource = useCallback((fn: (s: RowSource) => void) => {
    sourcesRef.current.forEach(fn);
  }, []);

  const blockListRef = useRef<BlockListSink | null>(null);
  const registerBlockList = useCallback((sink: BlockListSink) => {
    blockListRef.current = sink;
    return () => { if (blockListRef.current === sink) blockListRef.current = null; };
  }, []);

  // Re-marks the rows already on screen: refetching every tab would lose
  // pagination and re-hit Navidrome, and matching client-side would duplicate
  // the normalised-name rules in music/blocklist.ts, free to drift.
  const restampBlockMarks = useCallback(async () => {
    const byId = new Map<string, Track>();
    eachSource(s => {
      for (const t of s.getRows()) if (t?.id && !byId.has(t.id)) byId.set(t.id, t);
    });
    if (byId.size === 0) return;
    const rows = [...byId.values()].map(t => ({ id: t.id, artist: t.artist, album: t.album }));
    try {
      const marks: Record<string, BlockRef | null> = {};
      // Chunked to stay under the endpoint's per-call cap.
      for (let i = 0; i < rows.length; i += CHECK_CHUNK) {
        const r = await adminFetch('/library/blocklist/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: rows.slice(i, i + CHECK_CHUNK) }),
        });
        if (!r.ok) return;
        const j = await r.json() as { blocked?: Record<string, BlockRef | null> };
        Object.assign(marks, j.blocked || {});
      }
      eachSource(s => s.applyBlockMarks(marks));
    } catch {
      // Enrichment, not the operation — the block itself succeeded, so leave
      // the last-known marks rather than toasting.
    }
  }, [adminFetch, eachSource]);

  const invalidateAllRows = useCallback(() => { eachSource(s => s.invalidate()); }, [eachSource]);

  // --- likes (#1253) -------------------------------------------------------
  const [likeIndex, setLikeIndex] = useState<LikeIndex>({});
  const [liking, setLiking] = useState<string | null>(null);

  const loadLikeIndex = useCallback(async () => {
    if (!ready) return;
    try {
      const r = await adminFetch('/likes/index');
      if (!r.ok) throw new Error(`likes failed (${r.status})`);
      const j = await r.json() as { songs?: LikeIndex };
      setLikeIndex(j.songs || {});
    } catch {
      // A missing index just means no hearts are lit — never toast this.
      setLikeIndex({});
    }
  }, [adminFetch, ready]);

  useEffect(() => { loadLikeIndex(); }, [loadLikeIndex]);

  // Patches the index without a refetch so the heart responds immediately.
  // The Liked list's own row removal rides onLikeChanged with a null `next`.
  const patchLike = useCallback((
    id: string, next: { count: number; operator: boolean } | null,
  ) => {
    setLikeIndex(prev => {
      const out = { ...prev };
      if (next && next.count > 0) out[id] = next; else delete out[id];
      return out;
    });
    eachSource(s => s.onLikeChanged(id, next && next.count > 0 ? next : null));
  }, [eachSource]);

  const toggleLike = useCallback(async (track: Track, isLiked: boolean) => {
    const before = likeIndex[track.id]
      ?? { count: track.likeCount ?? 0, operator: !!track.likedByOperator };
    setLiking(track.id);
    // Optimistic: the operator's own heart is +1/-1 on the total.
    patchLike(track.id, {
      count: Math.max(0, before.count + (isLiked ? -1 : 1)),
      operator: !isLiked,
    });
    try {
      const r = isLiked
        ? await adminFetch(`/likes/song/${encodeURIComponent(track.id)}/operator`, { method: 'DELETE' })
        : await adminFetch(`/likes/song/${encodeURIComponent(track.id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: track.title, artist: track.artist, album: track.album,
            genre: track.genre, year: track.year, duration: track.duration,
          }),
        });
      const j = await r.json().catch(() => ({})) as { count?: number; error?: string };
      if (!r.ok) throw new Error(j.error || `like failed (${r.status})`);
      // Settle on the server's count — it folds in listener likes that landed
      // between render and click.
      patchLike(track.id, { count: j.count ?? 0, operator: !isLiked });
    } catch (err) {
      patchLike(track.id, before);
      notify.err(errorMessage(err));
    } finally {
      setLiking(null);
    }
  }, [adminFetch, likeIndex, patchLike]);

  // Wraps DELETE /likes/song/:id — drops LISTENER likes too, which the heart
  // deliberately never does.
  const clearLikes = useCallback(async (track: Track) => {
    setLiking(track.id);
    try {
      const r = await adminFetch(`/likes/song/${encodeURIComponent(track.id)}`, { method: 'DELETE' });
      const j = await r.json().catch(() => ({})) as { removed?: number; error?: string };
      if (!r.ok) throw new Error(j.error || `clear failed (${r.status})`);
      patchLike(track.id, null);
      notify.ok(`Cleared ${j.removed ?? 0} like${j.removed === 1 ? '' : 's'} on “${track.title || track.id}”`);
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setLiking(null);
    }
  }, [adminFetch, patchLike]);

  // --- selection + playlists ----------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [plBusy, setPlBusy] = useState(false);

  const loadPlaylists = useCallback(async () => {
    if (!ready) return;
    try {
      const r = await adminFetch('/playlists');
      const j = await r.json().catch(() => ({})) as { playlists?: PlaylistSummary[]; error?: string };
      if (!r.ok) throw new Error(j.error || `playlists failed (${r.status})`);
      setPlaylists(j.playlists || []);
    } catch (err) {
      notify.err(errorMessage(err));
      setPlaylists([]);
    }
  }, [adminFetch, ready]);

  useEffect(() => {
    if (selected.size > 0 && playlists === null && ready) loadPlaylists();
  }, [selected.size, playlists, ready, loadPlaylists]);

  // Selection is per-view: ids from another tab would be invisible, and
  // "Add 12" with 9 off-screen rows is a foot-gun. The panel calls this on
  // every tab change — the provider cannot see `tab`.
  const clearSelection = useCallback(() => { setSelected(new Set()); }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllRows = useCallback((rows: Track[]) => {
    setSelected(prev => {
      const all = rows.length > 0 && rows.every(r => prev.has(r.id));
      const next = new Set(prev);
      if (all) rows.forEach(r => next.delete(r.id));
      else rows.forEach(r => next.add(r.id));
      return next;
    });
  }, []);

  const addSelectedToPlaylist = useCallback(async (target: { playlistId?: string; name?: string }) => {
    const songIds = Array.from(selected);
    if (songIds.length === 0) return;
    setPlBusy(true);
    try {
      const r = target.playlistId
        ? await adminFetch(`/playlists/${encodeURIComponent(target.playlistId)}/tracks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ songIds }),
          })
        : await adminFetch('/playlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: target.name, songIds }),
          });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || `add to playlist failed (${r.status})`);
      const plName = target.name
        || playlists?.find(p => p.id === target.playlistId)?.name
        || 'playlist';
      notify.ok(`added ${songIds.length} track${songIds.length === 1 ? '' : 's'} to “${plName}”`);
      setSelected(new Set());
      loadPlaylists();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setPlBusy(false);
    }
  }, [adminFetch, selected, playlists, loadPlaylists]);

  // --- mood vocab ----------------------------------------------------------
  const [vocab, setVocab] = useState<string[]>([]);
  const seedVocab = useCallback((v: string[]) => {
    if (v.length) setVocab(prev => (prev.length ? prev : v));
  }, []);
  const ensureVocab = useCallback(async () => {
    if (vocab.length) return;
    try {
      const r = await adminFetch('/library/browse?limit=1');
      if (!r.ok) return;
      const j = (await r.json()) as BrowseResponse;
      if (j.moodVocab?.length) setVocab(j.moodVocab);
    } catch { /* editor shows a "loading moods…" hint until this lands */ }
  }, [vocab.length, adminFetch]);

  // --- per-row actions -----------------------------------------------------
  const [queuing, setQueuing] = useState<string | null>(null);
  const [retagging, setRetagging] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string | null>(null);

  const flash = useCallback((id: string) => {
    setFlashId(id);
    setTimeout(() => setFlashId(curr => (curr === id ? null : curr)), 1100);
  }, []);

  const queueTrack = useCallback(async (track: Track) => {
    setQueuing(track.id);
    try {
      const r = await adminFetch('/dj/queue-track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(track),
      });
      const j = await r.json().catch(() => ({})) as { queuePosition?: number; error?: string };
      if (!r.ok) throw new Error(j.error || `queue failed (${r.status})`);
      notify.ok(`queued “${track.title}” · position ${j.queuePosition}`);
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setQueuing(null);
    }
  }, [adminFetch]);

  const retagTrack = useCallback(async (track: Track) => {
    setRetagging(track.id);
    try {
      const r = await adminFetch('/library/retag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(track),
      });
      const j = await r.json() as { moods?: string[]; energy?: string | null; error?: string };
      if (!r.ok) throw new Error(j.error || `retag failed (${r.status})`);
      const tagStr = j.moods?.length ? j.moods.join(', ') : '—';
      notify.ok(`retagged · ${tagStr} [${j.energy || '?'}]`);
      flash(track.id);
      // The server stamps retagged rows source='llm'.
      eachSource(s => s.onTagged({
        track, moods: j.moods || [], energy: j.energy ?? null,
        cleared: false, applyToAlbum: false, source: 'llm',
      }));
      reloadCoverage();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setRetagging(null);
    }
  }, [adminFetch, eachSource, flash, reloadCoverage]);

  const onEditTrack = useCallback((t: Track) => {
    setEditingId(curr => {
      if (curr === t.id) return null;
      ensureVocab();
      return t.id;
    });
  }, [ensureVocab]);

  const cancelEdit = useCallback(() => { setEditingId(null); }, []);

  const saveManualTag = useCallback(async (
    track: Track, moods: string[], energy: string | null, applyToAlbum: boolean,
  ) => {
    setManualBusy(track.id);
    try {
      const r = await adminFetch('/library/manual-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: track.id, moods, energy, applyToAlbum }),
      });
      const j = (await r.json().catch(() => ({}))) as
        { ok?: boolean; updated?: number; cleared?: boolean; error?: string };
      if (!r.ok) throw new Error(j.error || `save failed (${r.status})`);
      const cleared = !!j.cleared;
      const n = j.updated ?? 1;
      const scope = applyToAlbum ? `${n} album track${n === 1 ? '' : 's'}` : 'track';
      notify.ok(cleared ? `cleared tags · ${scope}` : `tagged ${scope} · ${moods.join(', ') || '—'}`);
      setEditingId(null);
      flash(track.id);
      eachSource(s => s.onTagged({
        track, moods, energy, cleared, applyToAlbum, source: 'manual',
      }));
      reloadCoverage();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setManualBusy(null);
    }
  }, [adminFetch, eachSource, flash, reloadCoverage]);

  // --- blocklist -----------------------------------------------------------
  // Shared by the Blocked tab's Unblock, the row-level unblock and the block
  // toast's Undo, so all three get the same list update and re-mark.
  const removeBlockEntry = useCallback(async (
    e: { type: BlockType; id: string; name?: string | null },
    { quiet = false }: { quiet?: boolean } = {},
  ) => {
    const r = await adminFetch(`/library/blocklist/${e.type}/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) {
      const j = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(j.error || `unblock failed (${r.status})`);
    }
    blockListRef.current?.remove(e.type, e.id);
    if (!quiet) notify.ok(`“${e.name || e.id}” can play again`);
    await restampBlockMarks();
  }, [adminFetch, restampBlockMarks]);

  const blockTrack = useCallback(async (track: Track, type: BlockType) => {
    setBlocking(track.id);
    try {
      const r = await adminFetch('/library/blocklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, trackId: track.id }),
      });
      const j = await r.json().catch(() => ({})) as { entry?: BlockEntry; purged?: number; error?: string };
      if (!r.ok) throw new Error(j.error || `block failed (${r.status})`);
      const what = type === 'track' ? `“${track.title}”` : type === 'album' ? `album “${track.album}”` : track.artist;
      const entry = j.entry;
      // Undo rather than a confirm dialog: the row badge keeps a wrong scope
      // visible even after the toast goes.
      const msg = `${what} will never air${j.purged ? ` · ${j.purged} dropped from queue` : ''}`;
      if (entry) {
        notify.undo(msg, () => {
          removeBlockEntry(entry, { quiet: true })
            .then(() => notify.ok(`“${entry.name || entry.id}” can play again`))
            .catch(err => notify.err(errorMessage(err)));
        });
      } else {
        notify.ok(`${msg} — manage in the Blocked tab`);
      }
      if (entry) blockListRef.current?.add(entry);
      await restampBlockMarks();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setBlocking(null);
    }
  }, [adminFetch, removeBlockEntry, restampBlockMarks]);

  // Lifts whichever entry matched this row — possibly an album or artist block
  // made from a different row entirely. Rule refs never reach here (TrackTable
  // offers no one-click unblock for them — a rule can block hundreds of rows),
  // so the guard is a type-level formality.
  const unblockRow = useCallback(async (track: Track, ref: BlockRef) => {
    if (ref.kind === 'rule') return;
    setBlocking(track.id);
    try {
      await removeBlockEntry(ref);
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setBlocking(null);
    }
  }, [removeBlockEntry]);

  const value = useMemo<LibraryShared>(() => ({
    adminFetch, ready, coverage, reloadCoverage,
    registerRowSource, registerBlockList, restampBlockMarks, invalidateAllRows,
    likeIndex, liking, toggleLike, clearLikes,
    selected, toggleSelect, toggleAllRows, clearSelection,
    playlists, plBusy, addSelectedToPlaylist,
    vocab, seedVocab, ensureVocab,
    queuing, retagging, flashId, editingId, manualBusy, blocking,
    queueTrack, retagTrack, onEditTrack, cancelEdit, saveManualTag,
    blockTrack, unblockRow, removeBlockEntry,
  }), [
    adminFetch, ready, coverage, reloadCoverage,
    registerRowSource, registerBlockList, restampBlockMarks, invalidateAllRows,
    likeIndex, liking, toggleLike, clearLikes,
    selected, toggleSelect, toggleAllRows, clearSelection,
    playlists, plBusy, addSelectedToPlaylist,
    vocab, seedVocab, ensureVocab,
    queuing, retagging, flashId, editingId, manualBusy, blocking,
    queueTrack, retagTrack, onEditTrack, cancelEdit, saveManualTag,
    blockTrack, unblockRow, removeBlockEntry,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Shared by the row lists that patch a tagged row in place rather than
// refetching. `source` must mirror what the server stamped: 'manual' for the
// inline editor, 'llm' for single-track retag.
export function patchTaggedRows(rows: Track[] | null, ev: TagEvent): Track[] | null {
  if (!rows) return rows;
  const { track, moods, energy, cleared, applyToAlbum, source } = ev;
  return rows.map(r => {
    const hit = r.id === track.id || (applyToAlbum && !!track.album && r.album === track.album);
    if (!hit) return r;
    return cleared
      ? { ...r, moods: [], energy: null, source: null }
      : { ...r, moods, energy, source };
  });
}

// Stamp fresh blockedBy marks onto a plain row list. Ids absent from the map
// are left alone — the check only reports on rows it was asked about.
export function applyMarks(rows: Track[] | null, marks: Record<string, BlockRef | null>): Track[] | null {
  if (!rows) return rows;
  return rows.map(t => (t.id in marks ? { ...t, blockedBy: marks[t.id] } : t));
}
