import { lookupRecordingResearch, type MbRecordingResearch } from '../music/musicbrainz.js';
import {
  createResearchEvidence,
  unavailableResearchEvidence,
  type ResearchClaim,
  type ResearchEvidence,
} from './research-evidence.js';

const CACHE_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; evidence: ResearchEvidence }>();

function keyPart(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function trackResearchClaims(
  subject: { artist: string; title: string },
  sourceId: string,
  recording: MbRecordingResearch,
): ResearchClaim[] {
  const claims: ResearchClaim[] = [];
  const year = /^(\d{4})/.exec(recording.firstReleaseDate || '')?.[1];
  if (year) {
    claims.push({
      text: `“${subject.title}” by ${subject.artist} was first released in ${year}.`,
      sourceIds: [sourceId],
      topic: 'first-release',
    });
  }
  if (recording.producers.length) {
    claims.push({
      text: `“${subject.title}” by ${subject.artist} was produced by ${recording.producers.join(' and ')}.`,
      sourceIds: [sourceId],
      topic: 'production-credit',
    });
  }
  if (recording.mixers.length) {
    claims.push({
      text: `“${subject.title}” by ${subject.artist} was mixed by ${recording.mixers.join(' and ')}.`,
      sourceIds: [sourceId],
      topic: 'mixing-credit',
    });
  }
  if (recording.remixers.length) {
    claims.push({
      text: `“${subject.title}” by ${subject.artist} was remixed by ${recording.remixers.join(' and ')}.`,
      sourceIds: [sourceId],
      topic: 'remixing-credit',
    });
  }
  return claims;
}

export async function researchExactTrack(artist: string, title: string): Promise<ResearchEvidence> {
  const subject = { artist: String(artist || '').trim(), title: String(title || '').trim() };
  if (!subject.artist || !subject.title) return unavailableResearchEvidence(subject, 'artist and title are required');
  const key = `${keyPart(subject.artist)}\u0000${keyPart(subject.title)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.evidence;

  const recording = await lookupRecordingResearch(subject);
  if (!recording) {
    const evidence = unavailableResearchEvidence(subject, 'MusicBrainz found no exact artist/title recording');
    cache.set(key, { expiresAt: Date.now() + CACHE_MS, evidence });
    return evidence;
  }

  const sourceId = `musicbrainz-recording-${recording.id}`;
  const claims = trackResearchClaims(subject, sourceId, recording);
  const evidence = createResearchEvidence({
    subject,
    claims,
    sources: [{
      id: sourceId,
      provider: 'musicbrainz',
      label: `MusicBrainz recording: ${recording.title} — ${recording.artists.join(', ')}`,
      url: `https://musicbrainz.org/recording/${recording.id}`,
      retrievedAt: new Date().toISOString(),
    }],
  });
  cache.set(key, { expiresAt: Date.now() + CACHE_MS, evidence });
  return evidence;
}
