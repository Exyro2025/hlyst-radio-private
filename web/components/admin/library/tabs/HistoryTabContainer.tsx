'use client';

import { useCallback, useEffect, useState } from 'react';
import { notify, errorMessage } from '../../../../lib/notify';
import { HistoryTab } from '../HistoryTab';
import { useLibrary } from '../LibraryContext';
import type { PlayEntry } from '../types';
import { PAGE_SIZE } from '../types';

// Deliberately registers NO RowSource: a PlayEntry is not a Track (no
// blockedBy, no moods) and the air log is immutable, so none of the cross-tab
// events mean anything here. Do not "fix" the omission.
export default function HistoryTabContainer() {
  const { adminFetch, ready, queuing, queueTrack } = useLibrary();

  const [rows, setRows] = useState<PlayEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: number) => {
    if (!ready) return;
    setLoading(true);
    try {
      const r = await adminFetch(`/library/history?limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}`);
      if (!r.ok) throw new Error(`history load failed (${r.status})`);
      const j = await r.json() as { total?: number; rows?: PlayEntry[] };
      setRows(j.rows || []);
      setTotal(j.total || 0);
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [adminFetch, ready]);

  useEffect(() => {
    if (ready) load(page);
  }, [ready, page, load]);

  return (
    <HistoryTab
      rows={rows}
      total={total}
      page={page}
      setPage={setPage}
      loading={loading}
      queuing={queuing}
      onQueue={queueTrack}
      onRefresh={() => load(page)}
    />
  );
}
