export type EvaluationStage = 'route' | 'recover' | 'commit';

export interface ToolContract {
  name: string;
  required?: readonly string[];
  enums?: Readonly<Record<string, readonly string[]>>;
}

export interface ExpectedRoute {
  firstCallOneOf: readonly string[];
  arguments?: Readonly<Record<string, unknown>>;
}

export interface ExpectedRecovery {
  emptyTool: string;
  nextCallOneOf: readonly string[];
}

export interface ExpectedCommit {
  surfacedIds: readonly string[];
  acceptableIds: readonly string[];
  preferredIds?: readonly string[];
  forbiddenIds?: readonly string[];
}

export interface FunctionGemmaScenario {
  id: string;
  stage: EvaluationStage;
  split: 'validation';
  description: string;
  prompt: string;
  tools: readonly ToolContract[];
  mockResults?: Readonly<Record<string, unknown>>;
  route?: ExpectedRoute;
  recovery?: ExpectedRecovery;
  commit?: ExpectedCommit;
}

export interface PredictedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface FunctionGemmaPrediction {
  scenario: string;
  calls: PredictedToolCall[];
  latencyMs?: number;
  iteration?: number;
}

export type ScoreDimension =
  | 'protocol'
  | 'routing'
  | 'recovery'
  | 'grounding'
  | 'editorial';

export interface DimensionScore {
  passed: boolean;
  violations: string[];
}

export interface ScenarioScore {
  scenario: string;
  stage: EvaluationStage;
  dimensions: Partial<Record<ScoreDimension, DimensionScore>>;
  passed: boolean;
  latencyMs: number | null;
}
