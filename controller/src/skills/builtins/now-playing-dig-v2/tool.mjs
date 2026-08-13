// Exact-track research through Subwave's curated specialist-source service.
// Unlike the legacy skill, no general search snippets reach the speaking model.
export const description = 'Fetch provenance-bearing facts for the exact track on air from specialist music data sources. Use only an explicit returned claim; unavailable means stay silent.';

export default async function digCurrentTrack(ctx, state, services) {
  const current = services.nowPlaying();
  const artist = String(current?.artist || '').trim();
  const title = String(current?.title || '').trim();
  if (!artist || !title || /^unknown/i.test(artist) || /^unknown/i.test(title)) {
    return { available: false, reason: 'the current track has no usable artist/title identity' };
  }
  return services.researchTrack(artist, title);
}
