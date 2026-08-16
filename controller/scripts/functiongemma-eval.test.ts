import assert from 'node:assert/strict';
import test from 'node:test';
import { FUNCTIONGEMMA_VALIDATION_SCENARIOS } from './functiongemma/fixtures.js';
import { dimensionSummary, scorePrediction, scorePredictions } from './functiongemma/score.js';
import {
  openAiTool,
  parseFunctionGemmaContent,
  parseToolCalls,
  runModelScenario,
} from './functiongemma/model-runner.js';

const scenario = (id: string) => {
  const found = FUNCTIONGEMMA_VALIDATION_SCENARIOS.find(item => item.id === id);
  assert.ok(found, `missing fixture ${id}`);
  return found;
};

test('scores exact routing tool and arguments independently', () => {
  const good = scorePrediction(scenario('route.named-genre'), {
    scenario: 'route.named-genre',
    calls: [{ name: 'songsByGenre', arguments: { genre: 'Britpop' } }],
  });
  assert.equal(good.dimensions.protocol?.passed, true);
  assert.equal(good.dimensions.routing?.passed, true);

  const wrong = scorePrediction(scenario('route.named-genre'), {
    scenario: 'route.named-genre',
    calls: [{ name: 'searchLibrary', arguments: { query: 'Britpop' } }],
  });
  assert.equal(wrong.dimensions.protocol?.passed, true);
  assert.deepEqual(wrong.dimensions.routing?.violations, ['route:wrong-first-tool:searchLibrary', 'route:wrong-argument:genre']);
});

test('distinguishes recovery progress from repeating the failed tool', () => {
  const fixture = scenario('recover.empty-semantic-index');
  const loop = scorePrediction(fixture, {
    scenario: fixture.id,
    calls: [
      { name: 'tracksLikeThis', arguments: { songId: 'seed-current-track' } },
      { name: 'tracksLikeThis', arguments: { songId: 'seed-current-track' } },
      { name: 'done', arguments: { id: 'reflective-01', reason: 'flow', transition: null } },
    ],
  });
  assert.deepEqual(loop.dimensions.recovery?.violations, ['recovery:repeated-empty-tool']);

  const progressed = scorePrediction(fixture, {
    scenario: fixture.id,
    calls: [
      { name: 'tracksLikeThis', arguments: { songId: 'seed-current-track' } },
      { name: 'tracksByMood', arguments: { mood: 'reflective', energy: 'low' } },
      { name: 'done', arguments: { id: 'reflective-01', reason: 'flow', transition: null } },
    ],
  });
  assert.equal(progressed.passed, true);
});

test('separates grounded output from editorial quality', () => {
  const fixture = scenario('commit.same-artist-trap');
  const score = scorePrediction(fixture, {
    scenario: fixture.id,
    calls: [{ name: 'done', arguments: { id: 'trap-01', reason: 'similar', transition: 'normal' } }],
  });
  assert.equal(score.dimensions.protocol?.passed, true);
  assert.equal(score.dimensions.grounding?.passed, true);
  assert.equal(score.dimensions.editorial?.passed, false);
  assert.ok(score.dimensions.editorial?.violations.includes('editorial:forbidden-id:trap-01'));
});

test('missing predictions fail without hiding the dimensions', () => {
  const scores = scorePredictions([scenario('route.pinned-playlist')], []);
  assert.equal(scores[0].passed, false);
  assert.deepEqual(scores[0].dimensions.protocol?.violations, ['missing-prediction']);
  assert.deepEqual(dimensionSummary(scores), {
    protocol: { passed: 0, total: 1 },
    routing: { passed: 0, total: 1 },
  });
});

test('renders nullable done transition and parses string arguments', () => {
  const done = openAiTool(scenario('commit.quiet-flow').tools[0]);
  assert.deepEqual(done.function.parameters.properties.transition.type, ['string', 'null']);
  assert.deepEqual(done.function.parameters.properties.transition.enum, [
    'normal', 'blend', 'sweep', 'washout', 'dissolve', 'chop', 'loop', null,
  ]);
  assert.deepEqual(parseToolCalls([{
    id: 'call-1',
    function: { name: 'done', arguments: '{"id":"quiet-01","reason":"flow","transition":null}' },
  }]), [{ name: 'done', arguments: { id: 'quiet-01', reason: 'flow', transition: null } }]);
});

test('rejects the string NULL where the contract requires JSON null', () => {
  const fixture = scenario('commit.quiet-flow');
  const result = scorePrediction(fixture, {
    scenario: fixture.id,
    calls: [{
      name: 'done',
      arguments: { id: 'quiet-01', reason: 'flow', transition: 'NULL' },
    }],
  });
  assert.equal(result.dimensions.protocol?.passed, false);
  assert.deepEqual(result.dimensions.protocol?.violations, ['call-1:invalid-enum:transition']);
});

test('parses FunctionGemma native content returned by a content-only server', () => {
  assert.deepEqual(
    parseFunctionGemmaContent('<start_function_call>call:tracksByMood{mood:<escape>reflective<escape>,energy:<escape>low<escape>}<end_function_call>'),
    [{ name: 'tracksByMood', arguments: { mood: 'reflective', energy: 'low' } }],
  );
  assert.deepEqual(
    parseFunctionGemmaContent('<start_function_call>call:showPlaylistTracks{}'),
    [{ name: 'showPlaylistTracks', arguments: {} }],
  );
});

test('model runner carries an empty result into a different recovery call', async () => {
  const fixture = scenario('recover.empty-semantic-index');
  const replies = [
    { id: 'a', function: { name: 'tracksLikeThis', arguments: '{"songId":"seed-current-track"}' } },
    { id: 'b', function: { name: 'tracksByMood', arguments: '{"mood":"reflective","energy":"low"}' } },
    { id: 'c', function: { name: 'done', arguments: '{"id":"reflective-01","reason":"flow","transition":null}' } },
  ];
  const bodies: any[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const call = replies.shift();
    return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [call] } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const prediction = await runModelScenario(fixture, {
    baseUrl: 'http://model.test:8080', model: 'functiongemma',
  }, fakeFetch);
  assert.deepEqual(prediction.calls.map(call => call.name), ['tracksLikeThis', 'tracksByMood', 'done']);
  assert.equal(bodies[0].messages[0].role, 'developer');
  assert.equal(bodies[0].max_tokens, 256);
  assert.deepEqual(bodies[0].stop, ['<end_function_call>']);
  assert.match(bodies[1].messages.at(-1).content, /absent from the semantic index/);
  assert.equal(scorePrediction(fixture, prediction).passed, true);
});
