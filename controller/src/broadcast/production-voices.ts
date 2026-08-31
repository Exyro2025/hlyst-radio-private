// Production Voices — narrator/announcer voices for deliberately created
// production and commercial segments. Distinct from DJ personas: no
// schedule, no music profile, no autonomous on-air privilege. Only code
// that explicitly builds a production/commercial segment may select one.

export interface ProductionVoice {
  readonly id: string;
  readonly name: string;
  readonly role: 'male' | 'female';
  readonly voiceId: string;
}

export const PRODUCTION_VOICES: Record<string, ProductionVoice> = {
  'james-freeman': {
    id: 'james-freeman',
    name: 'James Freeman',
    role: 'male',
    voiceId: '1CgVOaiK0YikcFJJHWV0',
  },
  tiffany: {
    id: 'tiffany',
    name: 'Tiffany',
    role: 'female',
    voiceId: '6aDn1KB0hjpdcocrUkmq',
  },
};

export function getProductionVoice(id: string): ProductionVoice | null {
  return PRODUCTION_VOICES[id] ?? null;
}
