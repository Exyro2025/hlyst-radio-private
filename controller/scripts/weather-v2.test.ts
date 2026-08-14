import assert from 'node:assert/strict';
import test from 'node:test';

import { weatherOutlookClaim } from '../src/skills/weather-outlook.js';

const weather = (overrides = {}) => ({
  condition: 'cloudy',
  temp: 18,
  tempUnit: 'C',
  location: 'The Ribble Valley',
  outlook: [],
  ...overrides,
});

test('reports a genuine current-condition change', () => {
  assert.match(weatherOutlookClaim(weather(), 'clear', '10:00') || '', /changed from clear to cloudy/);
});

test('reports rain beginning with broad station-local timing', () => {
  const claim = weatherOutlookClaim(weather({
    outlook: [{ hoursAhead: 5, condition: 'rainy', temp: 16 }],
  }), 'cloudy', '10:00');
  assert.equal(claim, 'Rain is expected to begin in The Ribble Valley later this afternoon.');
});

test('reports precipitation ending', () => {
  const claim = weatherOutlookClaim(weather({
    condition: 'rainy',
    outlook: [{ hoursAhead: 2, condition: 'cloudy', temp: 17 }],
  }), 'rainy', '10:00');
  assert.equal(claim, 'Rain is expected to ease in The Ribble Valley within the next couple of hours.');
});

test('reports only useful temperature movement', () => {
  assert.equal(weatherOutlookClaim(weather({
    outlook: [{ hoursAhead: 6, condition: 'cloudy', temp: 22 }],
  }), 'cloudy', '10:00'), 'Temperatures in The Ribble Valley are expected to rise by around 4 degrees Celsius later this afternoon.');
  assert.equal(weatherOutlookClaim(weather({
    outlook: [{ hoursAhead: 6, condition: 'cloudy', temp: 21 }],
  }), 'cloudy', '10:00'), null);
});

test('forecast timing remains truthful across midnight', () => {
  const claim = weatherOutlookClaim(weather({
    outlook: [{ hoursAhead: 8, condition: 'rainy', temp: 16 }],
  }), 'cloudy', '23:00');
  assert.equal(claim, 'Rain is expected to begin in The Ribble Valley tomorrow morning.');
});

test('ordinary persistence stays silent', () => {
  assert.equal(weatherOutlookClaim(weather({
    outlook: [{ hoursAhead: 6, condition: 'cloudy', temp: 19 }],
  }), 'cloudy', '10:00'), null);
});
