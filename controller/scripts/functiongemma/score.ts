import type {
  DimensionScore,
  FunctionGemmaPrediction,
  FunctionGemmaScenario,
  PredictedToolCall,
  ScenarioScore,
  ScoreDimension,
  ToolContract,
} from './contracts.js';

function dimension(violations: string[]): DimensionScore {
  return { passed: violations.length === 0, violations };
}

function sameScalar(expected: unknown, actual: unknown): boolean {
  if (typeof expected === 'string' && typeof actual === 'string') {
    return expected.toLowerCase() === actual.toLowerCase();
  }
  return Object.is(expected, actual);
}

function protocolViolations(
  scenario: FunctionGemmaScenario,
  calls: readonly PredictedToolCall[],
  callsPerRound?: readonly number[],
): string[] {
  if (!calls.length) return ['no-tool-call'];
  const offered = new Map(scenario.tools.map(tool => [tool.name, tool]));
  const violations: string[] = [];
  for (const [round, count] of (callsPerRound ?? []).entries()) {
    if (count !== 1) violations.push(`round-${round + 1}:expected-one-call:received-${count}`);
  }
  for (const [index, call] of calls.entries()) {
    const contract = offered.get(call.name);
    if (!contract) {
      violations.push(`call-${index + 1}:unoffered-tool:${call.name}`);
      continue;
    }
    if (!call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) {
      violations.push(`call-${index + 1}:invalid-arguments`);
      continue;
    }
    violations.push(...validateArguments(contract, call, index));
  }
  return violations;
}

function validateArguments(contract: ToolContract, call: PredictedToolCall, index: number): string[] {
  const violations: string[] = [];
  const known = new Set([
    ...(contract.required ?? []),
    ...Object.keys(contract.enums ?? {}),
  ]);
  if (contract.additionalProperties !== true) {
    for (const key of Object.keys(call.arguments)) {
      if (!known.has(key)) violations.push(`call-${index + 1}:unexpected-argument:${key}`);
    }
  }
  for (const key of contract.required ?? []) {
    if (!(key in call.arguments)) violations.push(`call-${index + 1}:missing-argument:${key}`);
  }
  for (const [key, allowed] of Object.entries(contract.enums ?? {})) {
    if (!(key in call.arguments)) continue;
    const raw = call.arguments[key];
    const matches = allowed.some(value => value === null
      ? raw === null
      : typeof raw === 'string' && value.toLowerCase() === raw.toLowerCase());
    if (!matches) {
      violations.push(`call-${index + 1}:invalid-enum:${key}`);
    }
  }
  return violations;
}

function routeViolations(scenario: FunctionGemmaScenario, calls: readonly PredictedToolCall[]): string[] {
  if (!scenario.route) return [];
  const first = calls[0];
  if (!first) return ['route:no-first-call'];
  const violations: string[] = [];
  if (!scenario.route.firstCallOneOf.includes(first.name)) {
    violations.push(`route:wrong-first-tool:${first.name}`);
  }
  for (const [key, expected] of Object.entries(scenario.route.arguments ?? {})) {
    if (!sameScalar(expected, first.arguments?.[key])) violations.push(`route:wrong-argument:${key}`);
  }
  return violations;
}

function recoveryViolations(scenario: FunctionGemmaScenario, calls: readonly PredictedToolCall[]): string[] {
  if (!scenario.recovery) return [];
  const emptyIndex = calls.findIndex(call => call.name === scenario.recovery!.emptyTool);
  if (emptyIndex < 0) return [`recovery:missing-empty-tool:${scenario.recovery.emptyTool}`];
  const next = calls[emptyIndex + 1];
  if (!next) return ['recovery:no-state-progression'];
  if (next.name === scenario.recovery.emptyTool) return ['recovery:repeated-empty-tool'];
  if (!scenario.recovery.nextCallOneOf.includes(next.name)) {
    return [`recovery:wrong-alternative:${next.name}`];
  }
  const violations: string[] = [];
  for (const [key, expected] of Object.entries(scenario.recovery.arguments ?? {})) {
    if (!sameScalar(expected, next.arguments?.[key])) violations.push(`recovery:wrong-argument:${key}`);
  }
  return violations;
}

function commitCall(calls: readonly PredictedToolCall[]): PredictedToolCall | undefined {
  return [...calls].reverse().find(call => call.name === 'done');
}

function groundingViolations(scenario: FunctionGemmaScenario, calls: readonly PredictedToolCall[]): string[] {
  if (!scenario.commit) return [];
  const commit = commitCall(calls);
  if (!commit) return ['grounding:no-commit'];
  const id = String(commit.arguments?.id ?? '');
  return scenario.commit.surfacedIds.includes(id) ? [] : [`grounding:unsurfaced-id:${id || '<empty>'}`];
}

function editorialViolations(scenario: FunctionGemmaScenario, calls: readonly PredictedToolCall[]): string[] {
  if (!scenario.commit) return [];
  const commit = commitCall(calls);
  if (!commit) return ['editorial:no-commit'];
  const id = String(commit.arguments?.id ?? '');
  const violations: string[] = [];
  if (scenario.commit.forbiddenIds?.includes(id)) violations.push(`editorial:forbidden-id:${id}`);
  if (!scenario.commit.acceptableIds.includes(id)) violations.push(`editorial:unacceptable-id:${id || '<empty>'}`);
  if (scenario.commit.preferredIds?.length && !scenario.commit.preferredIds.includes(id)) {
    violations.push(`editorial:not-preferred:${id || '<empty>'}`);
  }
  return violations;
}

export function scorePrediction(
  scenario: FunctionGemmaScenario,
  prediction: FunctionGemmaPrediction | undefined,
): ScenarioScore {
  const calls = prediction?.calls ?? [];
  const dimensions: Partial<Record<ScoreDimension, DimensionScore>> = {
    protocol: dimension(prediction
      ? protocolViolations(scenario, calls, prediction.callsPerRound)
      : ['missing-prediction']),
  };
  if (scenario.route) dimensions.routing = dimension(routeViolations(scenario, calls));
  if (scenario.recovery) dimensions.recovery = dimension(recoveryViolations(scenario, calls));
  if (scenario.commit) {
    dimensions.grounding = dimension(groundingViolations(scenario, calls));
    dimensions.editorial = dimension(editorialViolations(scenario, calls));
  }
  return {
    scenario: scenario.id,
    stage: scenario.stage,
    dimensions,
    passed: Object.values(dimensions).every(result => result?.passed),
    latencyMs: Number.isFinite(prediction?.latencyMs) ? Number(prediction?.latencyMs) : null,
  };
}

export function scorePredictions(
  scenarios: readonly FunctionGemmaScenario[],
  predictions: readonly FunctionGemmaPrediction[],
): ScenarioScore[] {
  const byScenario = new Map(predictions.map(prediction => [prediction.scenario, prediction]));
  return scenarios.map(scenario => scorePrediction(scenario, byScenario.get(scenario.id)));
}

export function dimensionSummary(scores: readonly ScenarioScore[]) {
  const totals = new Map<ScoreDimension, { passed: number; total: number }>();
  for (const score of scores) {
    for (const [name, result] of Object.entries(score.dimensions) as [ScoreDimension, DimensionScore][]) {
      const total = totals.get(name) ?? { passed: 0, total: 0 };
      total.total += 1;
      if (result.passed) total.passed += 1;
      totals.set(name, total);
    }
  }
  return Object.fromEntries(totals);
}
