import { z } from 'zod';
import { instruction } from '../prompts/instructions.js';

export const PRODUCER_TRANSITIONS = [
  'normal', 'blend', 'sweep', 'washout', 'dissolve', 'chop', 'loop',
] as const;

export const ProducerPickSchema = z.object({
  id: z.string().describe('exact id returned by a library discovery tool in this run'),
  reason: z.string().max(160).describe('brief internal editorial reason; never listener-facing copy'),
  transition: z.enum(PRODUCER_TRANSITIONS).nullable().describe('transition treatment, or null for the station default'),
});

export const ProducerSegmentSchema = z.object({
  air: z.boolean().describe('whether the segment is timely and worthwhile'),
  kind: z.string().nullable().describe('one offered segment kind when air is true; otherwise null'),
  reason: z.string().max(160).describe('brief internal reason for airing or staying silent'),
  sfx: z.string().nullable().describe('one offered production sound effect, or null; always null when air is false'),
});

export function producerPickSystem(rounds: number): string {
  return `${instruction('producer', 'frame')}\n\n${instruction('producer', 'pick', {
    rounds: Math.max(1, Math.floor(rounds)),
  })}`;
}

export function producerSegmentSystem(): string {
  return `${instruction('producer', 'frame')}\n\n${instruction('producer', 'segment')}`;
}

export function checkProducerPick(
  output: unknown,
  surfacedIds: ReadonlySet<string>,
  toolCalls: number,
): string[] {
  const parsed = ProducerPickSchema.safeParse(output);
  if (!parsed.success) return ['invalid-producer-pick'];
  const violations: string[] = [];
  if (toolCalls < 1) violations.push('no-discovery-tool');
  if (!surfacedIds.has(parsed.data.id)) violations.push('ungrounded-track-id');
  return violations;
}

export function checkProducerSegment(
  output: unknown,
  offeredKinds: ReadonlySet<string>,
  researchedKinds: ReadonlySet<string>,
  toolCalls: number,
  offeredSfx: ReadonlySet<string> = new Set(),
  researchRequired = true,
): string[] {
  const parsed = ProducerSegmentSchema.safeParse(output);
  if (!parsed.success) return ['invalid-producer-segment'];
  const plan = parsed.data;
  const violations: string[] = [];
  if (researchRequired && toolCalls < 1) violations.push('no-research-tool');
  if (!plan.air) {
    if (plan.kind !== null) violations.push('silent-segment-has-kind');
    if (plan.sfx !== null) violations.push('silent-segment-has-sfx');
    return violations;
  }
  if (!plan.kind || !offeredKinds.has(plan.kind)) violations.push('unoffered-kind');
  if (researchRequired && plan.kind && !researchedKinds.has(plan.kind)) violations.push('unresearched-kind');
  if (plan.sfx !== null && !offeredSfx.has(plan.sfx)) violations.push('unoffered-sfx');
  return [...new Set(violations)];
}
