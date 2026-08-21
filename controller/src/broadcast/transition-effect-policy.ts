// Controller-owned pacing for editorial transition effects. Models may suggest
// an effect, but they do not get to set the station's overall density: the
// same policy has to hold across the Producer, Persona and fallback pickers.

// "One every few songs" means an effect may follow only after two complete,
// genuinely plain seams. This caps editorial effects at one in three even when
// a model asks for one on every pick.
export const MIN_PLAIN_TRANSITIONS_BETWEEN_EFFECTS = 2;

export function editorialEffectAllowed(plainTransitionsSinceEffect: number): boolean {
  return plainTransitionsSinceEffect >= MIN_PLAIN_TRANSITIONS_BETWEEN_EFFECTS;
}

// Automatic safety effects (for example a length-cap washout) are still real
// effects on air, so they restart the editorial spacing. They are never vetoed
// by this policy; only a later model-requested effect is.
export function nextPlainTransitionsSinceEffect({
  plainTransitionsSinceEffect,
  effectFired,
}: {
  plainTransitionsSinceEffect: number;
  effectFired: boolean;
}): number {
  if (effectFired) return 0;
  return Math.min(
    MIN_PLAIN_TRANSITIONS_BETWEEN_EFFECTS,
    plainTransitionsSinceEffect + 1,
  );
}
