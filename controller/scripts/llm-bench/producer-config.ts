// Explicit split-architecture configuration for llm-bench. Kept separate from
// cli.ts so argument validation and in-memory settings mutation are testable
// without importing the CLI (which immediately starts a benchmark).

export interface ProducerCandidate {
  spec: string;
  provider: string;
  model: string;
  baseUrl?: string;
  ollamaUrl?: string;
  reasoning: boolean;
  numCtx?: number;
}

function httpUrl(raw: string | undefined, flag: string): string | undefined {
  if (!raw) return undefined;
  const clean = raw.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    throw new Error(`${flag} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${flag} must start with http:// or https://`);
  }
  return clean;
}

export function producerCandidateFromArgs(
  args: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): ProducerCandidate | null {
  const rawSpec = args['producer-model']?.trim();
  if (!rawSpec) {
    if (args['producer-base-url'] || args['producer-ollama-url']) {
      throw new Error('--producer-model is required when a Producer URL is supplied');
    }
    return null;
  }

  const split = rawSpec.indexOf(':');
  if (split < 1 || !rawSpec.slice(split + 1)) {
    throw new Error(`bad Producer model spec "${rawSpec}" — expected provider:model`);
  }
  const provider = rawSpec.slice(0, split);
  const model = rawSpec.slice(split + 1);
  const reasoningRaw = (args['producer-reasoning'] || 'off').toLowerCase();
  if (reasoningRaw !== 'on' && reasoningRaw !== 'off') {
    throw new Error('--producer-reasoning must be "on" or "off"');
  }
  const baseUrl = httpUrl(
    args['producer-base-url'] || env.PRODUCER_LLM_BASE_URL,
    '--producer-base-url',
  );
  const ollamaUrl = httpUrl(
    args['producer-ollama-url'] || env.PRODUCER_OLLAMA_URL,
    '--producer-ollama-url',
  );
  if (provider === 'openai-compatible' && !baseUrl) {
    throw new Error(
      '--producer-base-url (or PRODUCER_LLM_BASE_URL) is required for an openai-compatible Producer',
    );
  }

  let numCtx: number | undefined;
  if (args['producer-num-ctx'] !== undefined) {
    numCtx = Number(args['producer-num-ctx']);
    if (!Number.isInteger(numCtx) || numCtx < 1024 || numCtx > 262144) {
      throw new Error('--producer-num-ctx must be an integer from 1024 to 262144');
    }
  }

  return {
    spec: rawSpec,
    provider,
    model,
    ...(baseUrl ? { baseUrl } : {}),
    ...(ollamaUrl ? { ollamaUrl } : {}),
    reasoning: reasoningRaw === 'on',
    ...(numCtx ? { numCtx } : {}),
  };
}

export function applyProducerCandidate(llm: any, candidate: ProducerCandidate | null): void {
  if (!candidate) {
    llm.producer.enabled = false;
    return;
  }
  Object.assign(llm.producer, {
    enabled: true,
    provider: candidate.provider,
    model: candidate.model,
    reasoning: candidate.reasoning,
    ...(candidate.baseUrl ? { baseUrl: candidate.baseUrl } : {}),
    ...(candidate.ollamaUrl ? { ollamaUrl: candidate.ollamaUrl } : {}),
    ...(candidate.numCtx ? { numCtx: candidate.numCtx } : {}),
  });
}
