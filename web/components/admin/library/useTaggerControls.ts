'use client';

import { useCallback, useEffect, useState } from 'react';
import { notify, errorMessage } from '../../../lib/notify';
import { llmProviderLabel } from '../llm/providerMeta';
import { useLibrary } from './LibraryContext';
import type {
  AnalysisFailure,
  Batch,
  BudgetMode,
  LibraryStatsLite,
  RescanOpts,
  TagSteps,
  TaggerState,
} from '../LibraryTaggingPanel';
import type { SettingsResponse } from './types';

// The tagging/analysis half of the library page: the coverage + tagger +
// /settings polling loops and every operator action the Tagging panel fires.
// Split out of LibraryPanel so the panel is a tab router and nothing else.
//
// The two polling loops are deliberately separate. The fast one carries only
// the tagger snapshot so a 3s running poll doesn't drag the whole heavy
// /settings body across each time, and the slow one never touches tagger
// state — that is what keeps the two from racing.
export function useTaggerControls() {
  const {
    adminFetch, ready, coverage, reloadCoverage: loadCoverage, invalidateAllRows,
  } = useLibrary();

  const [failures, setFailures] = useState<AnalysisFailure[] | null>(null);
  const [tagger, setTagger] = useState<TaggerState | null>(null);
  const [libStats, setLibStats] = useState<LibraryStatsLite | null>(null);
  const [batch, setBatch] = useState<Batch>('500');
  const [taggerBusy, setTaggerBusy] = useState(false);
  // settings.audio.embeddings — null until the first /settings poll lands.
  const [audioEnabled, setAudioEnabled] = useState<boolean | null>(null);
  // settings.audio.vocalActivity — null until the first /settings poll lands.
  const [vocalEnabled, setVocalEnabled] = useState<boolean | null>(null);
  // settings.audio.analyzeQuietOnly + analyzeQuietMinutes — quiet-times gate (#1099).
  const [quietEnabled, setQuietEnabled] = useState<boolean | null>(null);
  const [quietMins, setQuietMins] = useState<number | null>(null);
  // Daily-token-budget tier from /settings — null until the first slow poll lands.
  const [budgetMode, setBudgetMode] = useState<BudgetMode | null>(null);
  // Provider attribution for the Tagging modal (#1162). Null until the slow
  // poll lands, and the modal then omits the attribution.
  const [llmLabel, setLlmLabel] = useState<string | null>(null);
  const [embedLabel, setEmbedLabel] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  // Per-track analysis failures (#1300 bug 3c). Fetched on demand, never
  // polled: `coverage.analysisFailed` already says whether there is anything to
  // look at, and on a healthy station the answer is zero forever.
  const loadFailures = useCallback(async () => {
    if (!ready) return;
    try {
      const r = await adminFetch('/library/analysis-failures?limit=200');
      if (!r.ok) return;
      const j = (await r.json()) as { failures?: AnalysisFailure[] };
      setFailures(j.failures || []);
    } catch { /* transient */ }
  }, [adminFetch, ready]);

  // Forget the failure history so the next run retries these tracks — the
  // operator's move after fixing the cause. Refreshes coverage so the banner
  // (driven by the count, not the list) goes away.
  const clearFailures = useCallback(async () => {
    if (!ready) return;
    try {
      const r = await adminFetch('/library/analysis-failures/clear', { method: 'POST' });
      if (!r.ok) return;
      setFailures([]);
      loadCoverage();
    } catch { /* transient */ }
  }, [adminFetch, ready, loadCoverage]);

  // Fast loop: just the tagger snapshot, so a 3s running poll doesn't drag the
  // whole heavy /settings body across each time.
  const loadTaggerState = useCallback(async () => {
    if (!ready) return;
    try {
      const r = await adminFetch('/library/tagger');
      if (!r.ok) return;
      const j = (await r.json()) as { tagger?: TaggerState };
      setTagger(j.tagger || null);
    } catch { /* transient */ }
  }, [adminFetch, ready]);

  // Slow loop: the rarely-changing settings-derived bits. Deliberately does NOT
  // touch tagger state (the fast loop owns it) so the two pollers never race.
  const loadSettingsData = useCallback(async () => {
    if (!ready) return;
    try {
      const r = await adminFetch('/settings');
      if (!r.ok) return;
      const j = (await r.json()) as SettingsResponse;
      if (j.libraryStats) setLibStats(j.libraryStats);
      if (j.values?.audio) {
        setAudioEnabled(!!j.values.audio.embeddings);
        setVocalEnabled(!!j.values.audio.vocalActivity);
        setQuietEnabled(!!j.values.audio.analyzeQuietOnly);
        setQuietMins(
          typeof j.values.audio.analyzeQuietMinutes === 'number'
            ? j.values.audio.analyzeQuietMinutes
            : 10,
        );
      }
      if (j.budget) setBudgetMode(j.budget.mode);
      // Which provider each tagging cost bills to (#1162). A blank embedding
      // provider follows the LLM provider; the embedding model shows only when
      // explicitly set (the default resolution table lives in Settings).
      if (j.values?.llm?.provider) {
        const llm = j.values.llm;
        setLlmLabel(llmProviderLabel(llm.provider) + (llm.model ? ` · ${llm.model}` : ''));
        const emb = j.values.embedding || {};
        const embProvider = emb.provider || llm.provider;
        setEmbedLabel(llmProviderLabel(embProvider) + (emb.model ? ` · ${emb.model}` : ''));
      }
    } catch { /* transient */ }
  }, [adminFetch, ready]);

  useEffect(() => {
    if (!ready) return;
    loadCoverage();
    const id = setInterval(loadCoverage, 60_000);
    return () => clearInterval(id);
  }, [ready, loadCoverage]);

  useEffect(() => {
    if (!ready) return;
    loadTaggerState();
    const interval = tagger?.running ? 3_000 : 10_000;
    const id = setInterval(loadTaggerState, interval);
    return () => clearInterval(id);
  }, [ready, loadTaggerState, tagger?.running]);

  useEffect(() => {
    if (!ready) return;
    loadSettingsData();
    const id = setInterval(loadSettingsData, 30_000);
    return () => clearInterval(id);
  }, [ready, loadSettingsData]);

  // While a run is live, poll coverage faster so the % visibly climbs.
  useEffect(() => {
    if (!ready || !tagger?.running) return;
    const id = setInterval(loadCoverage, 3_000);
    return () => clearInterval(id);
  }, [ready, tagger?.running, loadCoverage]);


  const remaining = coverage?.total != null ? Math.max(0, coverage.total - coverage.tagged) : null;

  const startTagger = async (steps?: TagSteps) => {
    setTaggerBusy(true);
    try {
      const limit = batch === 'all' ? null : parseInt(batch, 10);
      const body: Record<string, unknown> = limit && limit > 0 ? { limit } : {};
      // Absent on the legacy "Tag all" quick action, which sends a plain full run.
      if (steps) Object.assign(body, steps);
      const r = await adminFetch('/tag-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || `tagger start failed (${r.status})`);
      notify.ok('tagger started');
      setLogOpen(true);
      await loadTaggerState();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setTaggerBusy(false);
    }
  };

  const stopTagger = async () => {
    setTaggerBusy(true);
    try {
      const r = await adminFetch('/tag-library/stop', { method: 'POST' });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || `tagger stop failed (${r.status})`);
      notify.ok('stopping tagger…');
      await loadTaggerState();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setTaggerBusy(false);
    }
  };

  // Each opt maps to a tag-library CLI flag (reseed / reEnrich / reAnalyze /
  // upgrade). Sends no limit — a partial reseed leaves the library in a mixed
  // state KNN can't use, and `thenTag` continues into a full forward pass.
  const rescanTagger = async (opts: RescanOpts) => {
    setTaggerBusy(true);
    try {
      const r = await adminFetch('/tag-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || `re-scan failed (${r.status})`);
      notify.ok('re-scan started…');
      setLogOpen(true);
      await loadTaggerState();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setTaggerBusy(false);
    }
  };

  // Flips settings.audio.embeddings (the CLAP opt-in). Only persists the
  // setting — vectors appear after an analysis run.
  const toggleAudio = async () => {
    if (audioEnabled == null) return;
    setTaggerBusy(true);
    try {
      const r = await adminFetch('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: { embeddings: !audioEnabled } }),
      });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || `save failed (${r.status})`);
      setAudioEnabled(!audioEnabled);
      // On a lean analyzer, enabling is pending rather than done.
      const audioPending =
        coverage?.analysisAvailable !== false && coverage?.audioAnalysisAvailable === false;
      notify.ok(
        !audioEnabled
          ? audioPending
            ? 'sounds-like enabled — starts once the heavy analyzer is up'
            : 'sounds-like analysis enabled'
          : 'sounds-like analysis disabled',
      );
      // The toggle rides the slow /settings loop; refresh now so the flip shows
      // without waiting out the 30s tick.
      void loadSettingsData();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setTaggerBusy(false);
    }
  };

  // Prunes library entries whose tracks no longer exist in Navidrome. No
  // LLM/embedding cost, and it reuses the tagger's single-flight slot.
  const reconcile = async () => {
    setTaggerBusy(true);
    try {
      const r = await adminFetch('/library/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || `reconcile failed (${r.status})`);
      notify.ok('reconcile started, scanning Navidrome');
      setLogOpen(true);
      await loadTaggerState();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setTaggerBusy(false);
    }
  };

  // Runs as a background child on the tagger's single-flight state.
  const analyzeAudio = async () => {
    setTaggerBusy(true);
    try {
      const r = await adminFetch('/library/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || `analysis start failed (${r.status})`);
      notify.ok('audio analysis started');
      setLogOpen(true);
      await loadTaggerState();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setTaggerBusy(false);
    }
  };

  // Demucs vocal-activity opt-in (#646). Env ANALYZE_VOCAL_ACTIVITY still wins "on".
  const toggleVocal = async () => {
    if (vocalEnabled == null) return;
    setTaggerBusy(true);
    try {
      const r = await adminFetch('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: { vocalActivity: !vocalEnabled } }),
      });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || `save failed (${r.status})`);
      setVocalEnabled(!vocalEnabled);
      // Mirrors toggleAudio: enabling on a lean analyzer is "armed", not active.
      const vocalPending =
        coverage?.analysisAvailable !== false && coverage?.vocalAnalysisAvailable === false;
      notify.ok(
        !vocalEnabled
          ? vocalPending
            ? 'vocal-activity enabled — starts once the heavy analyzer is up'
            : 'vocal-activity analysis enabled'
          : 'vocal-activity analysis disabled',
      );
      // Refresh both loops now so the coverage-driven bits (vocalStatus, the
      // vocal meter row) don't wait out the 60s poll.
      void loadSettingsData();
      void loadCoverage();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setTaggerBusy(false);
    }
  };

  // Quiet-times gate (#1099): analysis pauses while listeners are tuned in. The
  // pass re-reads the toggle from disk on every check, so a flip takes effect
  // mid-run; env ANALYZE_QUIET_ONLY still wins "on".
  const toggleQuiet = async () => {
    if (quietEnabled == null) return;
    setTaggerBusy(true);
    try {
      const r = await adminFetch('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: { analyzeQuietOnly: !quietEnabled } }),
      });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || `save failed (${r.status})`);
      setQuietEnabled(!quietEnabled);
      notify.ok(
        !quietEnabled
          ? 'quiet times on — analysis pauses while anyone is listening'
          : 'quiet times off — analysis runs regardless of listeners',
      );
      void loadSettingsData();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setTaggerBusy(false);
    }
  };

  // Idle window for the quiet-times gate, in minutes (1–120).
  const saveQuietMinutes = async (minutes: number) => {
    setTaggerBusy(true);
    try {
      const r = await adminFetch('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: { analyzeQuietMinutes: minutes } }),
      });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || `save failed (${r.status})`);
      setQuietMins(minutes);
      notify.ok(`quiet window set — analysis resumes after ${minutes} min with no listeners`);
      void loadSettingsData();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setTaggerBusy(false);
    }
  };

  // vocal:true forces the analyze pass into the vocal scope (#646).
  const vocalBackfill = async () => {
    setTaggerBusy(true);
    try {
      const r = await adminFetch('/library/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocal: true }),
      });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || `vocal analysis start failed (${r.status})`);
      notify.ok('vocal analysis started');
      setLogOpen(true);
      await loadTaggerState();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setTaggerBusy(false);
    }
  };

  // Deletes library.db server-side; Navidrome is untouched, so every track
  // returns to the untagged pool. Refused (409) while a tagger run is active.
  const resetLibrary = async () => {
    setTaggerBusy(true);
    try {
      const r = await adminFetch('/library/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || `reset failed (${r.status})`);
      notify.ok('library reset — all tagging data wiped');
      // Drop the cached views so each tab reloads against the empty library.
      await loadCoverage();
      void loadSettingsData();
      // Each registered list clears itself and, where it is on screen,
      // refetches — the same set the five inline resets used to name by hand.
      invalidateAllRows();
    } catch (err) {
      notify.err(errorMessage(err));
    } finally {
      setTaggerBusy(false);
    }
  };

  return {
    coverage, remaining, tagger, libStats, failures,
    batch, setBatch, busy: taggerBusy, logOpen, setLogOpen,
    audioEnabled, vocalEnabled, quietEnabled, quietMins, budgetMode,
    llmLabel, embedLabel,
    startTagger, stopTagger, rescanTagger, reconcile, resetLibrary,
    analyzeAudio, vocalBackfill,
    toggleAudio, toggleVocal, toggleQuiet, saveQuietMinutes,
    loadFailures, clearFailures,
  };
}
