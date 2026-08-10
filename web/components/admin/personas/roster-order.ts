import type { Persona } from './types';

export interface PersonaRosterEntry {
  persona: Persona;
  index: number;
}

const PERSONA_NAME_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

// Display order only: callers retain `index` for RHF field paths, validation,
// deletion and editing. Reordering the form array itself would turn a visual
// navigation aid into a persisted settings change.
export function orderPersonaRoster(
  personas: Persona[],
  onAirPersonaId: string,
): PersonaRosterEntry[] {
  return personas
    .map((persona, index) => ({ persona, index }))
    .sort((left, right) => {
      const leftOnAir = left.persona.id === onAirPersonaId;
      const rightOnAir = right.persona.id === onAirPersonaId;
      if (leftOnAir !== rightOnAir) return leftOnAir ? -1 : 1;

      const leftName = left.persona.name.trim();
      const rightName = right.persona.name.trim();
      if (!leftName && rightName) return 1;
      if (leftName && !rightName) return -1;

      const byName = PERSONA_NAME_COLLATOR.compare(leftName, rightName);
      return byName || left.index - right.index;
    });
}
