export const description = 'Find one meaningful current or next-12-hour weather change from Open-Meteo. Use only an explicit returned claim; unavailable means stay silent.';

export const ready = () => true;

export default async function checkWeatherOutlook(ctx, state, services) {
  const condition = String(ctx?.weather?.condition || '').trim();
  const evidence = services.researchWeatherOutlook(
    ctx?.weather || {},
    state.weatherV2LastCondition || null,
    ctx?.clock?.hhmm || '',
  );
  if (condition && condition !== 'unknown') state.weatherV2LastCondition = condition;
  return evidence;
}
