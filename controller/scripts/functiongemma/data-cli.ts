import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateTrainingExamples, validateTrainingSets } from './training-data.js';

function argsOf(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index++) {
    const match = argv[index].match(/^--([a-z-]+)$/);
    if (match) args[match[1]] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : 'true';
  }
  return args;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

const args = argsOf(process.argv.slice(2));
const output = resolve(args.out ?? 'scripts/functiongemma/training/data');
const trainCount = positiveInteger(args['train-count'], 2_400, '--train-count');
const developmentCount = positiveInteger(args['development-count'], 400, '--development-count');
const train = generateTrainingExamples('train', trainCount);
const development = generateTrainingExamples('development', developmentCount);
const validation = validateTrainingSets(train, development);

mkdirSync(output, { recursive: true });
const writeJsonl = (name: string, rows: readonly unknown[]) => writeFileSync(
  resolve(output, name),
  `${rows.map(row => JSON.stringify(row)).join('\n')}\n`,
);
writeJsonl('train.jsonl', train);
writeJsonl('development.jsonl', development);
writeFileSync(resolve(output, 'manifest.json'), `${JSON.stringify({
  format: 'subwave.functiongemma-routing.v1',
  generatedAt: new Date().toISOString(),
  counts: { train: train.length, development: development.length },
  ...validation,
}, null, 2)}\n`);

console.log(`FunctionGemma data written to ${output}`);
console.log(`train=${train.length} development=${development.length}`);
for (const [family, count] of Object.entries(validation.families)) console.log(`${family.padEnd(42)} ${count}`);
console.log(`train sha256       ${validation.fingerprints.train}`);
console.log(`development sha256 ${validation.fingerprints.development}`);
