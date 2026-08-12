import {
  createResearchEvidence,
  unavailableResearchEvidence,
  type ResearchClaim,
  type ResearchEvidence,
  type ResearchSource,
} from './research-evidence.js';

const API_ROOT = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'SUB-WAVE radio controller (https://github.com/perminder-klair/subwave)';
const CACHE_MS = 24 * 60 * 60 * 1000;
const MIN_REQUEST_GAP_MS = 1_100;

interface CacheEntry {
  expiresAt: number;
  evidence: ResearchEvidence;
}

const cache = new Map<string, CacheEntry>();
let lastRequestStartedAt = 0;
let requestTail: Promise<void> = Promise.resolve();

function normalized(value: unknown): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function artistNames(recording: any): string[] {
  return (recording?.['artist-credit'] || [])
    .map((credit) => credit?.artist?.name || credit?.name)
    .filter(Boolean)
    .map(String);
}

export function exactMusicBrainzRecording(recordings: any[], artist: string, title: string): any | null {
  const wantedArtist = normalized(artist);
  const wantedTitle = normalized(title);
  const matches = (recordings || []).filter((recording) => {
    if (normalized(recording?.title) !== wantedTitle) return false;
    return artistNames(recording).some((name) => normalized(name) === wantedArtist);
  });
  // Search relevance often ranks a recent reissue above the original recording
  // even when both artist and title are exact. Prefer the earliest explicit
  // first-release date; only fall back to an undated result when none are dated.
  matches.sort((a, b) => {
    const aDate = String(a?.['first-release-date'] || '9999');
    const bDate = String(b?.['first-release-date'] || '9999');
    return aDate.localeCompare(bDate);
  });
  return matches[0] || null;
}

function yearOf(value: unknown): string | null {
  const match = /^(\d{4})/.exec(String(value || ''));
  return match ? match[1] : null;
}

function producerNames(recording: any): string[] {
  const names: string[] = (recording?.relations || [])
    .filter((relation) => normalized(relation?.type) === 'producer')
    .map((relation) => relation?.artist?.name)
    .filter(Boolean)
    .map((name) => String(name));
  return [...new Set<string>(names)];
}

export function musicBrainzEvidenceFromResponses({
  artist,
  title,
  search,
  lookup,
  retrievedAt = new Date().toISOString(),
}: {
  artist: string;
  title: string;
  search: any;
  lookup: any;
  retrievedAt?: string;
}): ResearchEvidence {
  const subject = { artist, title };
  const recording = exactMusicBrainzRecording(search?.recordings, artist, title);
  if (!recording?.id) return unavailableResearchEvidence(subject, 'MusicBrainz found no exact artist/title recording');

  const sourceId = `musicbrainz-recording-${recording.id}`;
  const sources: ResearchSource[] = [{
    id: sourceId,
    provider: 'musicbrainz',
    label: `MusicBrainz recording: ${recording.title} — ${artistNames(recording).join(', ')}`,
    url: `https://musicbrainz.org/recording/${recording.id}`,
    retrievedAt,
  }];
  const claims: ResearchClaim[] = [];
  const year = yearOf(recording['first-release-date']);
  if (year) {
    claims.push({
      text: `“${title}” by ${artist} was first released in ${year}.`,
      sourceIds: [sourceId],
      topic: 'first-release',
    });
  }
  const producers = producerNames(lookup);
  if (producers.length) {
    claims.push({
      text: `“${title}” by ${artist} was produced by ${producers.join(' and ')}.`,
      sourceIds: [sourceId],
      topic: 'production-credit',
    });
  }
  return createResearchEvidence({ subject, claims, sources });
}

async function politeFetch(url: URL): Promise<any> {
  let resolveTurn: () => void = () => {};
  const previous = requestTail;
  requestTail = new Promise<void>((resolve) => { resolveTurn = resolve; });
  await previous;
  try {
    const waitMs = Math.max(0, MIN_REQUEST_GAP_MS - (Date.now() - lastRequestStartedAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastRequestStartedAt = Date.now();
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`MusicBrainz HTTP ${response.status}`);
    return response.json();
  } finally {
    resolveTurn();
  }
}

export async function researchTrackOnMusicBrainz(artist: string, title: string): Promise<ResearchEvidence> {
  const subject = { artist: String(artist || '').trim(), title: String(title || '').trim() };
  if (!subject.artist || !subject.title) return unavailableResearchEvidence(subject, 'artist and title are required');
  const key = `${normalized(subject.artist)}\u0000${normalized(subject.title)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.evidence;

  const searchUrl = new URL(`${API_ROOT}/recording`);
  searchUrl.searchParams.set('query', `recording:"${subject.title.replace(/"/g, '\\"')}" AND artist:"${subject.artist.replace(/"/g, '\\"')}"`);
  searchUrl.searchParams.set('fmt', 'json');
  searchUrl.searchParams.set('limit', '25');
  const search = await politeFetch(searchUrl);
  const recording = exactMusicBrainzRecording(search?.recordings, subject.artist, subject.title);
  if (!recording?.id) {
    const evidence = unavailableResearchEvidence(subject, 'MusicBrainz found no exact artist/title recording');
    cache.set(key, { expiresAt: Date.now() + CACHE_MS, evidence });
    return evidence;
  }

  const lookupUrl = new URL(`${API_ROOT}/recording/${recording.id}`);
  lookupUrl.searchParams.set('inc', 'artist-rels');
  lookupUrl.searchParams.set('fmt', 'json');
  const lookup = await politeFetch(lookupUrl);
  const evidence = musicBrainzEvidenceFromResponses({ artist: subject.artist, title: subject.title, search, lookup });
  cache.set(key, { expiresAt: Date.now() + CACHE_MS, evidence });
  return evidence;
}
