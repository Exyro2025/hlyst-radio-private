'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { X } from 'lucide-react';
import { notify, errorMessage } from '../../../../lib/notify';
import { Card, Btn } from '../../ui';
import { num } from '../../LibraryTaggingPanel';
import type { LibraryStatsLite } from '../../LibraryTaggingPanel';
import { BrowseFilters } from '../BrowseFilters';
import { RowsTable } from '../RowsTable';
import { applyMarks, useLibrary } from '../LibraryContext';
import type { BrowseResponse, Energy, Sort, Vocal } from '../types';
import { PAGE_SIZE } from '../types';

export interface BrowseTabProps {
  // The filters live in useLibraryUrlState because they are mirrored to the
  // query string, which the panel owns. `page` is NOT mirrored, so it lives
  // here with the fetch that consumes it.
  moods: string[]; setMoods: Dispatch<SetStateAction<string[]>>;
  energy: Energy; setEnergy: (e: Energy) => void;
  vocal: Vocal; setVocal: (v: Vocal) => void;
  genre: string; setGenre: (g: string) => void;
  yearFrom: string; setYearFrom: (y: string) => void;
  yearTo: string; setYearTo: (y: string) => void;
  q: string; setQ: (q: string) => void;
  sort: Sort; setSort: (s: Sort) => void;
  // Falls back for the filter counts before the first browse response lands.
  libStats: LibraryStatsLite | null;
}

export default function BrowseTab({
  moods, setMoods, energy, setEnergy, vocal, setVocal, genre, setGenre,
  yearFrom, setYearFrom, yearTo, setYearTo, q, setQ, sort, setSort, libStats,
}: BrowseTabProps) {
  const { adminFetch, ready, registerRowSource, seedVocab } = useLibrary();

  const [browse, setBrowse] = useState<BrowseResponse | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [genreList, setGenreList] = useState<{ value: string; songCount: number }[]>([]);

  // Each run aborts the previous in-flight request: without it a slow earlier
  // response can land after a faster later one and show stale-filter results.
  const browseAbortRef = useRef<AbortController | null>(null);
  const runBrowse = useCallback(async () => {
    if (!ready) return;
    browseAbortRef.current?.abort();
    const ac = new AbortController();
    browseAbortRef.current = ac;
    setBrowseLoading(true);
    try {
      const params = new URLSearchParams();
      if (moods.length) params.set('moods', moods.join(','));
      if (energy !== 'any') params.set('energy', energy);
      if (vocal !== 'any') params.set('vocal', vocal);
      if (genre) params.set('genre', genre);
      if (yearFrom) params.set('yearFrom', yearFrom);
      if (yearTo) params.set('yearTo', yearTo);
      if (q.trim()) params.set('q', q.trim());
      params.set('sort', sort);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));
      const r = await adminFetch(`/library/browse?${params}`, { signal: ac.signal });
      if (!r.ok) throw new Error(`browse failed (${r.status})`);
      setBrowse((await r.json()) as BrowseResponse);
    } catch (err) {
      // Superseded by a newer run — that run owns the table and the spinner.
      if (ac.signal.aborted) return;
      notify.err(errorMessage(err));
      setBrowse(null);
    } finally {
      if (!ac.signal.aborted) setBrowseLoading(false);
    }
  }, [adminFetch, ready, moods, energy, vocal, genre, yearFrom, yearTo, q, sort, page]);

  // Debounced so typing in the free-text box doesn't fire per keystroke. The
  // tab guard is gone — this component only exists while Browse is open.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(runBrowse, 250);
    return () => clearTimeout(t);
  }, [ready, runBrowse]);

  useEffect(() => {
    if (!ready || genreList.length) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await adminFetch('/library/genres');
        if (!r.ok) return;
        const j = await r.json() as { genres: { value: string; songCount: number }[] };
        if (!cancelled) setGenreList(j.genres || []);
      } catch { /* skip */ }
    })();
    return () => { cancelled = true; };
  }, [ready, adminFetch, genreList.length]);

  useEffect(() => { setPage(0); }, [moods, energy, vocal, genre, yearFrom, yearTo, q, sort]);

  // The vocab only rides along on the browse response, so other tabs fetch a
  // one-row browse rather than hardcoding SHOW_MOODS into the bundle.
  useEffect(() => {
    if (browse?.moodVocab?.length) seedVocab(browse.moodVocab);
  }, [browse, seedVocab]);

  const browseRef = useRef(browse);
  browseRef.current = browse;
  useEffect(() => registerRowSource('browse', {
    getRows: () => browseRef.current?.rows || [],
    applyBlockMarks: marks => setBrowse(prev => (prev
      ? { ...prev, rows: applyMarks(prev.rows, marks) ?? prev.rows } : prev)),
    // Browse REFETCHES rather than patching: it is the one list whose
    // membership can change from a tag edit (a mood filter may stop matching).
    onTagged: () => { void runBrowse(); },
    onLikeChanged: () => {},
    invalidate: () => { setBrowse(null); void runBrowse(); },
  }), [registerRowSource, runBrowse]);

  const stats = browse?.stats;
  const moodCounts = stats?.byMood || libStats?.byMood || {};
  const energyCounts = stats?.byEnergy || libStats?.byEnergy || {};
  const totalPages = browse ? Math.max(1, Math.ceil(browse.total / PAGE_SIZE)) : 1;
  const filtersActive =
    moods.length > 0 || energy !== 'any' || vocal !== 'any' || !!genre || !!yearFrom || !!yearTo || !!q.trim();

  const clearFilters = () => {
    setMoods([]); setEnergy('any'); setVocal('any'); setGenre(''); setYearFrom(''); setYearTo(''); setQ('');
    setSort('artist'); setPage(0);
  };

  return (
    <>
      <BrowseFilters
        moodVocab={browse?.moodVocab || []}
        moodCounts={moodCounts}
        energyCounts={energyCounts}
        genreList={genreList}
        moods={moods} setMoods={setMoods}
        energy={energy} setEnergy={setEnergy}
        vocal={vocal} setVocal={setVocal}
        genre={genre} setGenre={setGenre}
        yearFrom={yearFrom} setYearFrom={setYearFrom}
        yearTo={yearTo} setYearTo={setYearTo}
        q={q} setQ={setQ}
        sort={sort} setSort={setSort}
      />

      {filtersActive && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <span className="caption">active</span>
          {moods.map(m => (
            <span key={m} className="lib-active-chip">
              {m}<button type="button" onClick={() => setMoods(moods.filter(x => x !== m))} aria-label={`remove ${m}`}>×</button>
            </span>
          ))}
          {energy !== 'any' && (
            <span className="lib-active-chip">{energy} energy<button type="button" onClick={() => setEnergy('any')} aria-label="remove energy">×</button></span>
          )}
          {vocal !== 'any' && (
            <span className="lib-active-chip">{vocal}<button type="button" onClick={() => setVocal('any')} aria-label="remove vocal filter">×</button></span>
          )}
          {genre && (
            <span className="lib-active-chip">{genre}<button type="button" onClick={() => setGenre('')} aria-label="remove genre">×</button></span>
          )}
          {(yearFrom || yearTo) && (
            <span className="lib-active-chip">{yearFrom || '…'}–{yearTo || '…'}<button type="button" onClick={() => { setYearFrom(''); setYearTo(''); }} aria-label="remove year">×</button></span>
          )}
          {q.trim() && (
            <span className="lib-active-chip">“{q.trim()}”<button type="button" onClick={() => setQ('')} aria-label="remove search">×</button></span>
          )}
          <button type="button" className="inline-flex items-center gap-1 font-bold text-muted hover:text-ink" onClick={clearFilters}>
            <X size={12} /> clear all
          </button>
        </div>
      )}

      <Card
        title="Tracks"
        sub={browse ? `${num(browse.total)} match${browse.total === 1 ? '' : 'es'}` : ''}
        bodyClass="!p-0"
      >
        <RowsTable tab="browse" rows={browse?.rows || []} loading={browseLoading} />
      </Card>

      {browse && browse.total > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-y-2 text-[11px] text-muted">
          <span className="mono-num">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, browse.total)} of {num(browse.total)}
          </span>
          <span className="flex items-center gap-2">
            <Btn sm disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>‹ prev</Btn>
            <span className="mono-num">page {page + 1} of {totalPages}</span>
            <Btn sm disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>next ›</Btn>
          </span>
        </div>
      )}
    </>
  );
}
