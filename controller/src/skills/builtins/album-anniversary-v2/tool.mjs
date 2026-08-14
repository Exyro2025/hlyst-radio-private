export const description = 'Check exact OpenSubsonic album metadata for a qualifying original album anniversary. Use only an explicit returned claim; unavailable means stay silent.';

export const ready = () => true;

export default async function checkAlbumAnniversary(ctx, state, services) {
  return services.researchAlbumAnniversary(services.nowPlaying(), ctx);
}
