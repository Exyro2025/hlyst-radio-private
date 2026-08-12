// Research attempts and aired segments are deliberately separate concepts.
// A factual skill can run successfully yet produce nothing safe enough to air;
// repeating that same research every scheduler tick wastes tokens and does not
// make the evidence stronger. Completed tool calls therefore consume the
// skill's ordinary cooldown. Infrastructure failures get a shorter retry so a
// temporary provider outage does not silence the skill for its full cadence.

export const INFRASTRUCTURE_RETRY_CEILING_MS = 15 * 60 * 1000;

export type SkillAttemptOutcome = 'completed' | 'infrastructure-failure';

export interface SkillResearchAttempt {
  kind: string;
  outcome: SkillAttemptOutcome;
}

interface AttemptCapability {
  kind: string;
  toolName?: string | null;
}

interface RecordedToolCall {
  name?: string;
  result?: unknown;
}

function isInfrastructureFailure(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true;
  return typeof (result as { error?: unknown }).error === 'string'
    && (result as { error: string }).error.trim().length > 0;
}

// Collapse retries of the same skill into one scheduler outcome. If any call
// completed, research completed; only an all-error sequence is an infra retry.
export function researchAttemptsFromToolCalls(
  caps: AttemptCapability[],
  toolCalls: RecordedToolCall[] | null | undefined,
): SkillResearchAttempt[] {
  const calls = toolCalls || [];
  const attempts: SkillResearchAttempt[] = [];
  for (const cap of caps) {
    if (!cap.toolName) continue;
    const matches = calls.filter((call) => call?.name === cap.toolName);
    if (!matches.length) continue;
    attempts.push({
      kind: cap.kind,
      outcome: matches.some((call) => !isInfrastructureFailure(call.result))
        ? 'completed'
        : 'infrastructure-failure',
    });
  }
  return attempts;
}

export function researchAttemptDelayMs(
  outcome: SkillAttemptOutcome,
  configuredCooldownMs: number,
): number {
  const cooldown = Math.max(0, Number(configuredCooldownMs) || 0);
  return outcome === 'completed'
    ? cooldown
    : Math.min(cooldown, INFRASTRUCTURE_RETRY_CEILING_MS);
}
