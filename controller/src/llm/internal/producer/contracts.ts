import { z } from 'zod';
import { instruction } from '../prompts/instructions.js';

export const PRODUCER_TRANSITIONS = [
  'normal', 'blend', 'sweep', 'washout', 'dissolve', 'chop', 'loop',
] as const;

export const ProducerPickSchema = z.object({
  id: z.string().describe('exact id returned by a library discovery tool in this run'),
  reason: z.string().max(160).describe('brief internal editorial reason; never listener-facing copy'),
  speechBrief: z.string().max(240).nullable().describe('optional compact angle for the Persona, not a broadcast-ready script'),
  transition: z.enum(PRODUCER_TRANSITIONS).nullable().describe('transition treatment, or null for the station default'),
});

export const ProducerSegmentSchema = z.object({
  air: z.boolean().describe('whether the segment is timely and worthwhile'),
  kind: z.string().nullable().describe('one offered segment kind when air is true; otherwise null'),
  factRefs: z.array(z.string()).max(4).describe('exact fact reference ids returned by research tools; empty when air is false'),
  angle: z.string().max(240).nullable().describe('compact editorial angle for the Persona, not listener-facing prose'),
  reason: z.string().max(160).describe('brief internal reason for airing or staying silent'),
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
  surfacedRefs: ReadonlySet<string>,
  toolCalls: number,
): string[] {
  const parsed = ProducerSegmentSchema.safeParse(output);
  if (!parsed.success) return ['invalid-producer-segment'];
  const plan = parsed.data;
  const violations: string[] = [];
  if (toolCalls < 1) violations.push('no-research-tool');
  if (!plan.air) {
    if (plan.kind !== null) violations.push('silent-segment-has-kind');
    if (plan.factRefs.length) violations.push('silent-segment-has-facts');
    if (plan.angle !== null) violations.push('silent-segment-has-angle');
    return violations;
  }
  if (!plan.kind || !offeredKinds.has(plan.kind)) violations.push('unoffered-kind');
  if (!plan.angle) violations.push('missing-angle');
  if (!plan.factRefs.length) violations.push('missing-fact-ref');
  for (const ref of plan.factRefs) {
    if (!surfacedRefs.has(ref)) violations.push('ungrounded-fact-ref');
  }
  return [...new Set(violations)];
}
