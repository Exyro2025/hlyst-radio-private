export const description = 'Fetch one fresh, filtered Wikimedia On This Day event with explicit provenance. Use only the returned claim; unavailable means stay silent.';

export const ready = () => true;

export default async function getCuriosityEvidence(ctx, state, services) {
  return services.researchCuriosity();
}
