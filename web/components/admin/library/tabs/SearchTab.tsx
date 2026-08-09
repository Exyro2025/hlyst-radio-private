'use client';

import {
  useCallback, useEffect, useRef, useState,
  type ChangeEvent, type FormEvent,
} from 'react';
import { Search } from 'lucide-react';
import { notify, errorMessage } from '../../../../lib/notify';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../ui/input-group';
import { Card, Btn, Seg } from '../../ui';
import { RowsTable } from '../RowsTable';
import { applyMarks, patchTaggedRows, useLibrary } from '../LibraryContext';
import type { SearchMode, Track } from '../types';
import { SEARCH_PAGE } from '../types';

export interface SearchTabProps {
  searchQuery: string; setSearchQuery: (s: string) => void;
  searchMode: SearchMode; setSearchMode: (m: SearchMode) => void;
  // False until useLibraryUrlState's restore has run — gates the deep-link
  // auto-search so it fires against the restored query, not an empty one.
  urlRestored: boolean;
}

export default function SearchTab({
  searchQuery, setSearchQuery, searchMode, setSearchMode, urlRestored,
}: SearchTabProps) {
  const { adminFetch, ready, coverage, registerRowSource } = useLibrary();

  const [searchResults, setSearchResults] = useState<Track[] | null>(null);
  const [searching, setSearching] = useState(false);
  // Library-mode paging: a full page from /dj/search means more may exist.
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchingMore, setSearchingMore] = useState(false);
  // Load more must page the search that produced searchResults, not whatever is
  // currently typed in the (maybe edited) input.
  const lastSearchRef = useRef<{ q: string; mode: SearchMode } | null>(null);

  // 'library' pages Navidrome metadata search by offset; 'sound' is a one-shot
  // CLAP search with no paging (fixed KNN).
  const executeSearch = useCallback(async (text: string, mode: SearchMode, offset: number) => {
    if (!text || !ready) return;
    const append = offset > 0;
    if (append) setSearchingMore(true);
    else setSearching(true);
    try {
      let rows: Track[] = [];
      let more = false;
      if (mode === 'sound') {
        const r = await adminFetch(`/library/search-sound?q=${encodeURIComponent(text)}&limit=${SEARCH_PAGE}`);
        const j = await r.json().catch(() => ({})) as { results?: Track[]; error?: string };
        if (!r.ok) throw new Error(j.error || `sound search failed (${r.status})`);
        rows = j.results || [];
      } else {
        const r = await adminFetch(`/dj/search?q=${encodeURIComponent(text)}&limit=${SEARCH_PAGE}&offset=${offset}`);
        const j = await r.json().catch(() => ({})) as { results?: Track[]; hasMore?: boolean; error?: string };
        if (!r.ok) throw new Error(j.error || `search failed (${r.status})`);
        rows = j.results || [];
        // Absent on an old controller (fixed 12 rows) → no Load more, as before.
        more = !!j.hasMore;
      }
      setSearchResults(prev => (append ? [...(prev || []), ...rows] : rows));
      setSearchHasMore(more);
      lastSearchRef.current = { q: text, mode };
    } catch (err) {
      notify.err(errorMessage(err));
      if (!append) { setSearchResults([]); setSearchHasMore(false); }
    } finally {
      if (append) setSearchingMore(false);
      else setSearching(false);
    }
  }, [adminFetch, ready]);

  const runSearch = (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    executeSearch(searchQuery.trim(), searchMode, 0);
  };

  const loadMoreSearch = () => {
    const last = lastSearchRef.current;
    if (last) executeSearch(last.q, last.mode, searchResults?.length || 0);
  };

  // Runs once per mount, for a deep link (?tab=search&sq=…) and — because this
  // component now unmounts with the tab, taking its results with it — on a
  // return to Search with a query still in the box. Before the split the
  // results survived the tab switch and this fired only for the deep link.
  const autoSearchedRef = useRef(false);
  useEffect(() => {
    if (!ready || !urlRestored || autoSearchedRef.current) return;
    autoSearchedRef.current = true;
    if (searchQuery.trim()) executeSearch(searchQuery.trim(), searchMode, 0);
  }, [ready, urlRestored, searchQuery, searchMode, executeSearch]);

  const rowsRef = useRef(searchResults);
  rowsRef.current = searchResults;
  useEffect(() => registerRowSource('search', {
    getRows: () => rowsRef.current || [],
    applyBlockMarks: marks => setSearchResults(prev => applyMarks(prev, marks)),
    // Never refetched: that would lose Load-more paging and re-hit Navidrome.
    onTagged: ev => setSearchResults(prev => patchTaggedRows(prev, ev)),
    onLikeChanged: () => {},
    invalidate: () => { setSearchResults(null); setSearchHasMore(false); },
  }), [registerRowSource]);

  return (
    <>
      <Card bodyClass="!py-3">
        <div className="grid gap-2.5">
          {/* On lean installs the tab stays plain metadata search. */}
          {coverage?.soundSearchAvailable === true && (
            <div className="flex flex-wrap items-center gap-3">
              <Seg
                value={searchMode}
                options={[
                  { id: 'library', label: 'Library' },
                  { id: 'sound', label: 'Sounds like' },
                ]}
                onChange={(v: string) => {
                  setSearchMode(v as SearchMode);
                  setSearchResults(null);
                  setSearchHasMore(false);
                }}
              />
              {searchMode === 'sound' && (
                <span className="text-[11px] text-muted">
                  describe a sound — matches the audio itself, not titles or tags
                </span>
              )}
            </div>
          )}
          {/* Phone: query on its own row, both buttons on the row under it. */}
          <form onSubmit={runSearch} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_auto_auto]">
            <InputGroup className="col-span-2 sm:col-span-1">
              <InputGroupAddon><Search /></InputGroupAddon>
              <InputGroupInput
                // Deliberately no minLength: one-character queries are
                // legitimate (an album called "1") and a floor would reject
                // them with a native validation bubble.
                required
                placeholder={searchMode === 'sound'
                  ? 'dusty late-night jazz with brushed drums, warm acoustic fingerpicking…'
                  : 'floating points, kingdoms in colour, 2018…'}
                value={searchQuery}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              />
            </InputGroup>
            <Btn tone="accent" type="submit" disabled={searching || !searchQuery.trim() || !ready}>
              {searching ? 'Searching…' : 'Search'}
            </Btn>
            <Btn type="button" onClick={() => { setSearchQuery(''); setSearchResults(null); setSearchHasMore(false); }} disabled={searching}>
              Clear
            </Btn>
          </form>
        </div>
      </Card>

      <Card
        title="Search results"
        sub={searchResults ? `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}` : 'enter a query'}
        bodyClass="!p-0"
      >
        <RowsTable tab="search" rows={searchResults || []} loading={searching} />
      </Card>

      {searchHasMore && (searchResults?.length || 0) > 0 && (
        <div className="flex justify-center">
          <Btn onClick={loadMoreSearch} disabled={searchingMore}>
            {searchingMore ? 'Loading…' : 'Load more'}
          </Btn>
        </div>
      )}
    </>
  );
}
