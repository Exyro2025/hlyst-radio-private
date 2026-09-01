export const VOICE_KINDS = new Set(['dj-speak', 'link', 'station-id', 'hourly-check', 'handoff', 'banter', 'talkwave', 'vm-imaging', 'promo', 'traffic', 'severe-weather']);
export const TRACK_TIED_KINDS = new Set(['dj-speak', 'link']);
export const PENDING_VOICE_MAX_AGE_MS = 20 * 60_000;
export const DEDUPE_KINDS = new Set(['station-id', 'hourly-check', 'vm-imaging', 'traffic', 'severe-weather']);
export const KIND_LABEL: Record<string, string> = {
  'dj-speak': 'intro',
  'link': 'link',
  'station-id': 'ident',
  'hourly-check': 'hourly',
  'handoff': 'handoff',
  'banter': 'banter',
  'talkwave': 'talkwave',
  'vm-imaging': 'imaging',
  'promo': 'promo',
  'traffic': 'traffic',
  'severe-weather': 'weather alert',
};
export function registerSkillKinds(kinds: string[]): void {
  for (const k of kinds) {
    if (!k) continue;
    VOICE_KINDS.add(k);
    DEDUPE_KINDS.add(k);
  }
}