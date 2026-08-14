// Bounded, deterministic weather change policy for Weather v2. Open-Meteo's
// hourly table is reduced in code; the Persona receives one supported claim,
// never a forecast array it can reinterpret or embellish.

import {
  createResearchEvidence,
  unavailableResearchEvidence,
  type ResearchEvidence,
} from './research-evidence.js';

interface ForecastPoint {
  hoursAhead: number;
  condition: string;
  temp: number | null;
}

export interface WeatherOutlook {
  condition?: string;
  temp?: number | null;
  tempUnit?: string;
  location?: string;
  outlook?: ForecastPoint[];
}

function timingPhrase(hoursAhead: number, clock: string): string {
  if (hoursAhead <= 2) return 'within the next couple of hours';
  const currentHour = Number(/^\d{2}/.exec(String(clock || ''))?.[0]);
  if (!Number.isFinite(currentHour)) return 'later today';
  const absoluteHour = currentHour + hoursAhead;
  const futureHour = absoluteHour % 24;
  if (absoluteHour >= 24) {
    if (futureHour < 6) return 'overnight';
    if (futureHour < 12) return 'tomorrow morning';
    return 'tomorrow afternoon';
  }
  if (futureHour < 5) return 'later tonight';
  if (futureHour < 12) return 'later this morning';
  if (futureHour < 17) return 'later this afternoon';
  if (futureHour < 22) return 'later this evening';
  return 'later tonight';
}

function wetKind(condition: string): 'rain' | 'snow' | 'storm' | null {
  if (condition === 'rainy') return 'rain';
  if (condition === 'snowy') return 'snow';
  if (condition === 'stormy') return 'storm';
  return null;
}

function significantConditionChange(from: string, to: string): boolean {
  if (!to || to === from) return false;
  const fromWet = wetKind(from);
  const toWet = wetKind(to);
  if (fromWet !== toWet && (fromWet || toWet)) return true;
  return from === 'foggy' || to === 'foggy';
}

function temperatureThreshold(unit: string): number {
  return unit === 'F' ? 7 : 4;
}

export function weatherOutlookClaim(
  weather: WeatherOutlook,
  lastMentionedCondition: string | null,
  clock: string,
): string | null {
  const condition = String(weather?.condition || '').trim();
  const location = String(weather?.location || '').trim() || 'the station area';
  const unit = weather?.tempUnit === 'F' ? 'F' : 'C';
  const currentTemp = Number(weather?.temp);
  if (!condition || condition === 'unknown') return null;

  if (lastMentionedCondition && lastMentionedCondition !== condition) {
    const unitWord = unit === 'F' ? 'degrees Fahrenheit' : 'degrees Celsius';
    const temp = Number.isFinite(currentTemp) ? `, with temperatures around ${Math.round(currentTemp)} ${unitWord}` : '';
    return `Conditions in ${location} have changed from ${lastMentionedCondition} to ${condition}${temp}.`;
  }

  const outlook = Array.isArray(weather?.outlook)
    ? weather.outlook.filter((point) => point && point.hoursAhead >= 1 && point.hoursAhead <= 12)
    : [];
  const conditionChange = outlook.find((point) => significantConditionChange(condition, point.condition));
  if (conditionChange) {
    const timing = timingPhrase(conditionChange.hoursAhead, clock);
    const fromWet = wetKind(condition);
    const toWet = wetKind(conditionChange.condition);
    if (!fromWet && toWet === 'rain') return `Rain is expected to begin in ${location} ${timing}.`;
    if (!fromWet && toWet === 'snow') return `Snow is expected to begin in ${location} ${timing}.`;
    if (!fromWet && toWet === 'storm') return `Stormy weather is expected in ${location} ${timing}.`;
    if (fromWet && !toWet) return `${fromWet === 'storm' ? 'Stormy weather' : fromWet === 'snow' ? 'Snow' : 'Rain'} is expected to ease in ${location} ${timing}.`;
    return `Conditions in ${location} are expected to turn ${conditionChange.condition} ${timing}.`;
  }

  if (Number.isFinite(currentTemp)) {
    const threshold = temperatureThreshold(unit);
    const temperatureChange = outlook.find((point) => Number.isFinite(point.temp)
      && Math.abs(Number(point.temp) - currentTemp) >= threshold);
    if (temperatureChange) {
      const delta = Math.abs(Math.round(Number(temperatureChange.temp) - currentTemp));
      const direction = Number(temperatureChange.temp) > currentTemp ? 'rise' : 'fall';
      const unitWord = unit === 'F' ? 'degrees Fahrenheit' : 'degrees Celsius';
      return `Temperatures in ${location} are expected to ${direction} by around ${delta} ${unitWord} ${timingPhrase(temperatureChange.hoursAhead, clock)}.`;
    }
  }
  return null;
}

export function researchWeatherOutlook(
  weather: WeatherOutlook,
  lastMentionedCondition: string | null,
  clock: string,
): ResearchEvidence {
  const claim = weatherOutlookClaim(weather, lastMentionedCondition, clock);
  const subject = { topic: 'weather' };
  if (!claim) return unavailableResearchEvidence(subject, 'no meaningful current or forecast weather change');
  const sourceId = 'open-meteo-forecast';
  return createResearchEvidence({
    subject,
    claims: [{ text: claim, sourceIds: [sourceId], topic: 'weather-change' }],
    sources: [{
      id: sourceId,
      provider: 'open-meteo',
      label: 'Open-Meteo current conditions and 12-hour hourly forecast',
      url: 'https://open-meteo.com/',
      retrievedAt: new Date().toISOString(),
    }],
  });
}
