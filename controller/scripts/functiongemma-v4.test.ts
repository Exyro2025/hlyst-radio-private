import assert from 'node:assert/strict';
import test from 'node:test';
import { FUNCTIONGEMMA_VALIDATION_SCENARIOS } from './functiongemma/fixtures.js';
import { scorePrediction } from './functiongemma/score.js';
import { generateTrainingExamples, validateTrainingSets } from './functiongemma/training-data.js';

test('V4 data targets the closed tracksByMood schema and programme planning', () => {
  const train = generateTrainingExamples('train', 240);
  const development = generateTrainingExamples('development', 80);
  const validated = validateTrainingSets(train, development);

  assert.ok(validated.families['route.mood-schema-regression'] > 0);
  assert.ok(validated.families['route.genre-boundary-regression'] > 0);
  assert.ok(validated.families['route.genre-vs-mood-regression'] > 0);
  assert.ok(validated.families['recover.recover-journey-mood-vocabulary'] > 0);
  assert.ok(validated.families['recover.recover-journey-genre-boundary'] > 0);
  assert.ok(validated.families['route.programme-plan'] > 0);

  const moodCalls = [...train, ...development].flatMap(example => example.messages)
    .flatMap(message => message.tool_calls ?? [])
    .filter(call => call.function.name === 'tracksByMood');
  assert.ok(moodCalls.length > 0);
  for (const call of moodCalls) {
    assert.deepEqual(Object.keys(call.function.arguments).sort(), ['energy', 'mood']);
    assert.ok(['low', 'medium', 'high', null].some(value => Object.is(value, call.function.arguments.energy)));
  }
});

test('V4 acceptance rejects malformed mood arguments and accepts programme planning', () => {
  const mood = FUNCTIONGEMMA_VALIDATION_SCENARIOS.find(item => item.id === 'route.mood-live-schema');
  const genre = FUNCTIONGEMMA_VALIDATION_SCENARIOS.find(item => item.id === 'route.genre-exact-electro');
  const programme = FUNCTIONGEMMA_VALIDATION_SCENARIOS.find(item => item.id === 'programme.route.generate-plan');
  assert.ok(mood);
  assert.ok(genre);
  assert.ok(programme);

  const malformed = scorePrediction(mood, {
    scenario: mood.id,
    calls: [{ name: 'tracksByMood', arguments: { mood: 'energetic', energy: 'high', type: 'mood' } }],
  });
  assert.equal(malformed.dimensions.protocol?.passed, false);
  assert.match(malformed.dimensions.protocol?.violations.join('\n') ?? '', /unexpected-argument:type/);

  const exactGenre = scorePrediction(genre, {
    scenario: genre.id,
    calls: [{ name: 'songsByGenre', arguments: { genre: 'electro' } }],
  });
  assert.equal(exactGenre.passed, true);

  const accepted = scorePrediction(programme, {
    scenario: programme.id,
    calls: [{ name: 'generateProgrammePlan', arguments: {} }],
  });
  assert.equal(accepted.passed, true);
});

test('V4 corrective matrix keeps genre copying separate from valid mood recovery', () => {
  const genre = FUNCTIONGEMMA_VALIDATION_SCENARIOS.find(item => item.id === 'route.genre-not-station-mood');
  const journey = FUNCTIONGEMMA_VALIDATION_SCENARIOS.find(item => item.id === 'recover.empty-journey-waypoint');
  assert.ok(genre);
  assert.ok(journey);

  assert.equal(scorePrediction(genre, {
    scenario: genre.id,
    calls: [{ name: 'songsByGenre', arguments: { genre: 'art rock' } }],
    callsPerRound: [1],
  }).passed, true);

  const invalid = scorePrediction(journey, {
    scenario: journey.id,
    calls: [{ name: 'tracksTowardJourney', arguments: {} }, { name: 'tracksByMood', arguments: { mood: 'art-rock', energy: 'low' } }],
    callsPerRound: [1, 1],
  });
  assert.equal(invalid.dimensions.protocol?.passed, false);
  assert.equal(invalid.dimensions.recovery?.passed, false);
});

test('V4 hierarchy matrix pins both directions of the measured genre collisions', () => {
  const calls = generateTrainingExamples('development', 300, 0xA11CE5).flatMap(example => example.messages).flatMap(message => message.tool_calls ?? []);
  const genres = calls.filter(call => call.function.name === 'songsByGenre').map(call => call.function.arguments.genre);
  assert.ok(genres.includes('electro house'));
  assert.ok(genres.includes('northern soul'));
});
