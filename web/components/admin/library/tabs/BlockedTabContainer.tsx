'use client';

import { useCallback, useEffect, useState } from 'react';
import { notify, errorMessage } from '../../../../lib/notify';
import { BlockedTab } from '../BlockedTab';
import { BlockRulesCard } from '../BlockRulesCard';
import { useLibrary } from '../LibraryContext';
import type { BlockEntry } from '../types';

export default function BlockedTabContainer() {
  const {
    adminFetch, ready, registerBlockList, restampBlockMarks, removeBlockEntry,
  } = useLibrary();

  const [entries, setEntries] = useState<BlockEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [unblocking, setUnblocking] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const r = await adminFetch('/library/blocklist');
      if (!r.ok) throw new Error(`blocklist load failed (${r.status})`);
      const j = await r.json() as { entries?: BlockEntry[] };
      setEntries(j.entries || []);
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [adminFetch, ready]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  // The provider owns blockTrack/removeBlockEntry, because the block toast's
  // Undo fires from whichever tab raised it — but the entry LIST lives here.
  // Same seam as registerRowSource.
  useEffect(() => registerBlockList({
    add: entry => setEntries(prev => (prev ? [...prev, entry] : prev)),
    remove: (type, id) => setEntries(prev => (prev
      ? prev.filter(x => !(x.type === type && x.id === id)) : prev)),
  }), [registerBlockList]);

  const unblockEntry = async (e: BlockEntry) => {
    setUnblocking(`${e.type}:${e.id}`);
    try {
      await removeBlockEntry(e);
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setUnblocking(null);
    }
  };

  // One request, not N concurrent DELETEs: the controller rewrites
  // blocklist.json once, so parallel removes could persist a stale snapshot.
  const bulkUnblock = async (batch: BlockEntry[]) => {
    if (batch.length === 0) return;
    setBulkBusy(true);
    try {
      const r = await adminFetch('/library/blocklist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: batch.map(e => ({ type: e.type, id: e.id })) }),
      });
      const j = await r.json().catch(() => ({})) as { removed?: number; error?: string };
      if (!r.ok) throw new Error(j.error || `unblock failed (${r.status})`);
      const removed = j.removed ?? 0;
      const keys = new Set(batch.map(e => `${e.type}:${e.id}`));
      setEntries(prev => (prev ? prev.filter(x => !keys.has(`${x.type}:${x.id}`)) : prev));
      notify.ok(`${removed} entr${removed === 1 ? 'y' : 'ies'} can play again`);
      await restampBlockMarks();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <>
      {/* Attribute rules above the id entries — one "why won't this air"
          surface, two kinds of block. Self-contained; after a rule change only
          the row marks on the other tabs need re-stamping. */}
      <BlockRulesCard onChanged={() => { void restampBlockMarks(); }} />
      <BlockedTab
        entries={entries}
        loading={loading}
        unblocking={unblocking}
        bulkBusy={bulkBusy}
        onUnblock={unblockEntry}
        onBulkUnblock={bulkUnblock}
        onRefresh={load}
      />
    </>
  );
}
