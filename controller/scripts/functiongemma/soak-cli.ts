import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildNovelSoakCases, runSoakCase } from './soak.js';

function argsOf(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index++) {
    const match = argv[index].match(/^--([a-z-]+)$/);
    if (match) args[match[1]] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : 'true';
  }
  return args;
}

const args = argsOf(process.argv.slice(2));
if (!args['base-url'] || !args.model) {
  throw new Error('--base-url and --model are required');
}
const exampleCount = Math.max(1, Number.parseInt(args.examples ?? '300', 10) || 300);
const timeoutMs = Math.max(1_000, Number.parseInt(args['timeout-ms'] ?? '15000', 10) || 15_000);
const cases = buildNovelSoakCases(exampleCount);
const results = [];
for (const [index, candidate] of cases.entries()) {
  const result = await runSoakCase({
    candidate,
    baseUrl: args['base-url'],
    model: args.model,
    timeoutMs,
  });
  results.push(result);
  if (!result.passed) {
    console.error(`FAIL ${candidate.id}: expected ${JSON.stringify(result.expected)}, received ${JSON.stringify(result.actual)}`);
  } else if ((index + 1) % 50 === 0 || index + 1 === cases.length) {
    console.log(`progress ${index + 1}/${cases.length}`);
  }
}

const latencies = results.map(result => result.latencyMs).sort((left, right) => left - right);
const passed = results.filter(result => result.passed).length;
const report = {
  format: 'subwave.functiongemma-soak.v1',
  generatedAt: new Date().toISOString(),
  model: args.model,
  baseUrl: args['base-url'],
  examples: exampleCount,
  decisions: results.length,
  passed,
  failed: results.length - passed,
  latency: {
    averageMs: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    p50Ms: latencies[Math.floor(latencies.length * 0.50)],
    p95Ms: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)],
    maximumMs: latencies.at(-1),
  },
  failures: results.filter(result => !result.passed),
};
console.log(JSON.stringify(report, null, 2));
if (args.out) {
  const path = resolve(args.out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...report, results }, null, 2)}\n`);
  console.log(`Report ${path}`);
}
process.exitCode = report.failed ? 1 : 0;
