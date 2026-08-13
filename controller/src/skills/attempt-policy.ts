// A completed research attempt and an aired segment are different events.
// Some data-backed skills should not repeat the same lookup every scheduler
// tick merely because the evidence was empty or the DJ chose silence.
//
// This policy is opt-in through SKILL.md `cooldownOnAttempt: true`. Completed
// calls consume the configured cooldown; infrastructure failures retry sooner.

export const INFRASTRUCTURE_RETRY_CEILING_MS = 15 * 60 * 1000;

export type SkillAttemptOutcome = 'completed' | 'infrastructure-failure';

export interface SkillResearchAttempt {
  kind: string;
  outcome: SkillAttemptOutcome;
}

interface AttemptCapability {
  kind: string;
  toolName?: string | null;
  cooldownOnAttempt?: boolean;
}

interface RecordedToolCall {
  name?: string;
  result?: unknown;
}

export function hasRequiredEvidence(
  cap: AttemptCapability & { requiresEvidence?: boolean },
  toolCalls: RecordedToolCall[] | null | undefined,
): boolean {
  if (!cap.requiresEvidence) return true;
  if (!cap.toolName) return false;
  return (toolCalls || []).some((call) => {
    if (call?.name !== cap.toolName || !call.result || typeof call.result !== 'object') return false;
    return (call.result as { available?: unknown }).available === true;
  });
}

function isInfrastructureFailure(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true;
  return typeof (result as { error?: unknown }).error === 'string'
    && (result as { error: string }).error.trim().length > 0;
}

export function researchAttemptsFromToolCalls(
  caps: AttemptCapability[],
  toolCalls: RecordedToolCall[] | null | undefined,
): SkillResearchAttempt[] {
  const calls = toolCalls || [];
  const attempts: SkillResearchAttempt[] = [];
  for (const cap of caps) {
    if (!cap.cooldownOnAttempt || !cap.toolName) continue;
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

export function directResearchAttempt(
  cap: AttemptCapability,
  result: unknown,
): SkillResearchAttempt[] {
  if (!cap.cooldownOnAttempt || !cap.toolName) return [];
  return [{
    kind: cap.kind,
    outcome: isInfrastructureFailure(result) ? 'infrastructure-failure' : 'completed',
  }];
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
