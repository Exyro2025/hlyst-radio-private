// Evidence policy for Album anniversary v2. The legacy skill trusts a track's
// plain year, which can be the date of a reissue or compilation. This path uses
// the album-level OpenSubsonic fields designed for that distinction.

import { getAlbumDetails, getSong } from '../music/subsonic.js';
import {
  createResearchEvidence,
  unavailableResearchEvidence,
  type ResearchEvidence,
} from './research-evidence.js';

export interface AnniversaryAlbum {
  id?: string;
  name?: string;
  artist?: string;
  year?: number | string | null;
  originalReleaseDate?: { year?: number | string | null } | null;
  releaseTypes?: unknown;
  isCompilation?: boolean | null;
}

interface AnniversaryContext {
  at?: string;
  date?: { iso?: string } | null;
}

interface AnniversaryTrack {
  id?: string;
  albumId?: string;
  artist?: string;
  album?: string;
}

function normalizedType(value: unknown): string {
  return String(value || '').toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim();
}

const REJECTED_RELEASE_TYPES = /\b(?:compilation|single|ep|extended play|remix|mixtape|dj mix)\b/;

export function albumAnniversaryClaim(
  album: AnniversaryAlbum,
  stationYear: number,
): { text: string; album: string; artist: string; releasedYear: number; years: number } | null {
  const albumName = String(album?.name || '').trim();
  const artist = String(album?.artist || '').trim();
  const releasedYear = Number(album?.originalReleaseDate?.year);
  const releaseTypes = Array.isArray(album?.releaseTypes)
    ? album.releaseTypes.map(normalizedType).filter(Boolean)
    : [];
  if (!albumName || !artist || !Number.isInteger(stationYear)) return null;
  if (!Number.isInteger(releasedYear) || releasedYear < 1900 || releasedYear > stationYear) return null;
  if (album?.isCompilation === true) return null;
  if (!releaseTypes.some((type) => type === 'album' || type.endsWith(' album'))) return null;
  if (releaseTypes.some((type) => REJECTED_RELEASE_TYPES.test(type))) return null;
  const years = stationYear - releasedYear;
  if (years < 5 || years % 5 !== 0) return null;
  return {
    text: `“${albumName}” by ${artist} was originally released in ${releasedYear} and turns ${years} this year.`,
    album: albumName,
    artist,
    releasedYear,
    years,
  };
}

function stationYearOf(ctx: AnniversaryContext): number {
  const iso = String(ctx?.date?.iso || ctx?.at || '');
  const year = Number(/^\d{4}/.exec(iso)?.[0]);
  return Number.isInteger(year) ? year : NaN;
}

export async function researchAlbumAnniversary(
  track: AnniversaryTrack | null | undefined,
  ctx: AnniversaryContext,
): Promise<ResearchEvidence> {
  const subject = {
    artist: String(track?.artist || '').trim(),
    title: String(track?.album || '').trim(),
    topic: 'album-anniversary',
  };
  if (!track?.id) return unavailableResearchEvidence(subject, 'the current track has no library id');
  const song = track.albumId ? track : await getSong(track.id);
  const albumId = String(song?.albumId || '').trim();
  if (!albumId) return unavailableResearchEvidence(subject, 'the current track has no resolvable album id');
  const album = await getAlbumDetails(albumId);
  if (!album) return unavailableResearchEvidence(subject, 'OpenSubsonic returned no album metadata');
  const claim = albumAnniversaryClaim(album, stationYearOf(ctx));
  if (!claim) {
    return unavailableResearchEvidence(
      subject,
      'the release is not a qualifying original non-compilation album anniversary',
    );
  }
  const sourceId = `opensubsonic-album-${albumId}`;
  return createResearchEvidence({
    subject: { artist: claim.artist, title: claim.album, topic: 'album-anniversary' },
    claims: [{ text: claim.text, sourceIds: [sourceId], topic: 'album-anniversary' }],
    sources: [{
      id: sourceId,
      provider: 'opensubsonic',
      label: `OpenSubsonic album metadata: ${claim.album} — ${claim.artist}`,
      retrievedAt: new Date().toISOString(),
    }],
  });
}
