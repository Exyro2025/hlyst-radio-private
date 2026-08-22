import * as library from './library.js';
import * as subsonic from './subsonic.js';
import { applyStrictLocks, hasEraBound, type VocalMode } from './show-filter.js';
import { resolveExcludedPlaylistIds, resolveShowPlaylistPool } from './show-playlist.js';

type Candidate = { id?: string; title?: string | null; artist?: string | null; year?: number | null; originalYear?: number | null; isCompilation?: boolean | null; genres?: string[] | null; genre?: string | null; moods?: string[] | null; audioMoods?: string[] | null; energy?: string | null; vocalRanges?: unknown[] | null };
type Locks = { genres: string[]; eras: Array<{ fromYear?: number | null; toYear?: number | null }>; moods: string[]; energies: string[]; vocals: VocalMode | null };
export interface ShowCandidateDiagnostic { strict: boolean; library: { indexed: number; matchingFilters: number; afterExclusions: number; effective: number }; playlist: null | { total: number; matchingFilters: number; afterExclusions: number; effective: number }; warnings: string[] }

function hasMusicFilter(show: any): boolean { return !!(show?.genres?.length || show?.moods?.length || show?.energies?.length || show?.vocals || hasEraBound(show?.eras)); }
function filtered(rows: Candidate[], locks: Locks): Candidate[] { return applyStrictLocks(rows, locks, { starve: true }); }
function exclude(rows: Candidate[], ids: Set<string> | null): Candidate[] { return ids?.size ? rows.filter(row => row.id && !ids.has(row.id)) : rows; }

// Pure count funnel. It deliberately excludes recency and journey state: those
// are transient discovery constraints, not properties of a show configuration.
export function buildShowCandidateDiagnostic({ show, libraryRows, playlistRows, excludedIds, locks, warnings = [] }: { show: any; libraryRows: Candidate[]; playlistRows: Candidate[] | null; excludedIds: Set<string> | null; locks: Locks; warnings?: string[] }): ShowCandidateDiagnostic {
  const strict = show?.filtersStrict === true && hasMusicFilter(show);
  const libraryFiltered = filtered(libraryRows, locks);
  const playlistFiltered = playlistRows ? filtered(playlistRows, locks) : null;
  const libraryEffective = exclude(strict ? libraryFiltered : libraryRows, excludedIds);
  const playlistEffective = playlistFiltered == null ? null : exclude(strict ? playlistFiltered : playlistRows!, excludedIds);
  const playlistStrict = !!(show?.playlistStrict && playlistRows);
  return {
    strict,
    library: { indexed: libraryRows.length, matchingFilters: libraryFiltered.length, afterExclusions: exclude(libraryFiltered, excludedIds).length, effective: playlistStrict ? (playlistEffective?.length ?? 0) : libraryEffective.length },
    playlist: playlistRows == null ? null : { total: playlistRows.length, matchingFilters: playlistFiltered!.length, afterExclusions: exclude(playlistFiltered!, excludedIds).length, effective: playlistEffective!.length },
    warnings,
  };
}

export async function diagnoseShowCandidates(show: any): Promise<ShowCandidateDiagnostic> {
  await library.load();
  const stats = library.stats();
  const warnings: string[] = [];
  const genres: string[] = [];
  for (const requested of show?.genres ?? []) {
    try { const resolved = await subsonic.resolveGenreName(requested); if (resolved) genres.push(resolved); else warnings.push(`Genre “${requested}” is not present in the library, so it is not an active lock.`); }
    catch { warnings.push(`Could not resolve genre “${requested}”; it is not counted as an active lock.`); }
  }
  const moodCovered = Object.keys(stats.byMood ?? {}).length > 0;
  const energyCovered = Object.keys(stats.byEnergy ?? {}).length > 0;
  const vocalCovered = library.vocalAnalyzedCount() > 0;
  if (show?.moods?.length && !moodCovered) warnings.push('Mood tags have no library coverage, so the mood filter is not active.');
  if (show?.energies?.length && !energyCovered) warnings.push('Energy tags have no library coverage, so the energy filter is not active.');
  if (show?.vocals && !vocalCovered) warnings.push('Vocal analysis has no library coverage, so the vocal filter is not active.');
  const locks: Locks = { genres, eras: hasEraBound(show?.eras) ? show.eras : [], moods: moodCovered ? (show?.moods ?? []) : [], energies: energyCovered ? (show?.energies ?? []) : [], vocals: vocalCovered ? (show?.vocals ?? null) : null };
  const [playlistPool, excludedIds] = await Promise.all([resolveShowPlaylistPool(show), resolveExcludedPlaylistIds(show)]);
  if (show?.playlistIds?.length && !playlistPool) warnings.push('None of the pinned playlists could be resolved to tracks.');
  if (show?.filtersStrict !== true && hasMusicFilter(show)) warnings.push('Strict filter is off: matching filters is advisory; the show may draw from the wider library.');
  return buildShowCandidateDiagnostic({ show, libraryRows: library.candidateFilterTracks(), playlistRows: playlistPool?.tracks ?? null, excludedIds, locks, warnings });
}
