// FunctionGemma evaluation entry point. It can score an existing JSONL capture
// or call a separate OpenAI-compatible model endpoint directly. Neither mode
// reads nor mutates the live station's settings, queue or session.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { FUNCTIONGEMMA_VALIDATION_SCENARIOS } from './fixtures.js';
import { dimensionSummary, scorePrediction, scorePredictions } from './score.js';
import { runModelScenario } from './model-runner.js';
import type { FunctionGemmaPrediction } from './contracts.js';

function usage(message?: string): never {
  if (message) console.error(`error: ${message}\n`);
  console.error('Usage:');
  console.error('  npm run functiongemma:eval -- --predictions <results.jsonl>');
  console.error('  npm run functiongemma:eval -- --base-url <url> --model <name> [--iterations N] [--scenarios id,id] [--out report.json]');
  process.exit(2);
}

function argsOf(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index++) {
    const match = argv[index].match(/^--([a-z-]+)$/);
    if (match) args[match[1]] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : 'true';
  }
  return args;
}

function readPredictions(path: string): FunctionGemmaPrediction[] {
  const output: FunctionGemmaPrediction[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of readFileSync(path, 'utf8').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    let value: any;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`${path}:${index + 1}: invalid JSON`);
    }
    if (typeof value?.scenario !== 'string' || !Array.isArray(value?.calls)) {
      throw new Error(`${path}:${index + 1}: expected { scenario, calls[] }`);
    }
    if (seen.has(value.scenario)) throw new Error(`${path}:${index + 1}: duplicate scenario ${value.scenario}`);
    seen.add(value.scenario);
    output.push(value);
  }
  return output;
}

function scenariosFromArgs(args: Record<string, string>) {
  if (!args.scenarios) return [...FUNCTIONGEMMA_VALIDATION_SCENARIOS];
  const requested = new Set(args.scenarios.split(',').map(value => value.trim()).filter(Boolean));
  const selected = FUNCTIONGEMMA_VALIDATION_SCENARIOS.filter(scenario => requested.has(scenario.id));
  const unknown = [...requested].filter(id => !selected.some(scenario => scenario.id === id));
  if (unknown.length) usage(`unknown scenario(s): ${unknown.join(', ')}`);
  return selected;
}

async function predictionsFromArgs(
  args: Record<string, string>,
  scenarios = scenariosFromArgs(args),
): Promise<FunctionGemmaPrediction[]> {
  if (args.predictions) return readPredictions(resolve(args.predictions));
  if (!args['base-url'] || !args.model) usage('--base-url and --model are required for a live candidate run');
  const iterations = Math.max(1, Number.parseInt(args.iterations ?? '1', 10) || 1);
  const predictions: FunctionGemmaPrediction[] = [];
  for (let iteration = 1; iteration <= iterations; iteration++) {
    for (const scenario of scenarios) {
      process.stdout.write(`run ${iteration}/${iterations} ${scenario.id} ... `);
      const prediction = await runModelScenario(scenario, {
        baseUrl: args['base-url'],
        model: args.model,
        apiKey: args['api-key'] || process.env.FUNCTIONGEMMA_API_KEY,
        timeoutMs: Number.parseInt(args['timeout-ms'] ?? '30000', 10) || 30_000,
      });
      prediction.iteration = iteration;
      predictions.push(prediction);
      console.log(`${prediction.latencyMs}ms`);
    }
  }
  return predictions;
}

const args = argsOf(process.argv.slice(2));
const scenarios = scenariosFromArgs(args);
const predictions = await predictionsFromArgs(args, scenarios);
const scenariosById = new Map(scenarios.map(scenario => [scenario.id, scenario]));
const scores = predictions.length > scenarios.length
  ? predictions.map(prediction => {
      const scenario = scenariosById.get(prediction.scenario);
      if (!scenario) throw new Error(`unknown scenario ${prediction.scenario}`);
      return scorePrediction(scenario, prediction);
    })
  : scorePredictions(scenarios, predictions);

for (const score of scores) {
  const failures = Object.entries(score.dimensions)
    .flatMap(([dimension, result]) => result?.violations.map(v => `${dimension}:${v}`) ?? []);
  console.log(`${score.passed ? 'PASS' : 'FAIL'} ${score.scenario}${failures.length ? ` — ${failures.join(', ')}` : ''}`);
}

console.log('\nDimensions');
for (const [dimension, result] of Object.entries(dimensionSummary(scores))) {
  console.log(`${dimension.padEnd(10)} ${result.passed}/${result.total}`);
}

const passed = scores.filter(score => score.passed).length;
console.log(`\nOverall ${passed}/${scores.length}`);
if (args.out) {
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: args.model ?? null,
    baseUrl: args['base-url'] ?? null,
    iterations: Number.parseInt(args.iterations ?? '1', 10) || 1,
    scenarios: scenarios.map(scenario => scenario.id),
    predictions,
    scores,
    dimensions: dimensionSummary(scores),
    overall: { passed, total: scores.length },
  }, null, 2)}\n`);
  console.log(`Report ${outPath}`);
}
process.exitCode = passed === scores.length ? 0 : 1;
