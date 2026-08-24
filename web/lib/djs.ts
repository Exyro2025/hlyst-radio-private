// HLYST DJ roster — owned by the web app directly, independent of the
// controller's persona schema (which only has id/name/tagline/avatar/soul).
// This holds the richer editorial fields from the HLYST Programming Bible.
//
// Place this file at: web/lib/djs.ts
//
// PLACEHOLDER TEXT: every bio/quote/field below is a placeholder marked
// with [PLACEHOLDER] — replace with real content once written. Portrait
// paths point to /djs/<slug>.jpg — upload real photos to web/public/djs/
// with those exact filenames and the placeholders disappear automatically.

export interface DjProfile {
  slug: string;
  name: string;
  onAirName: string;
  title: string;
  schedule: string;
  portrait: string; // path under /public
  about: string;
  inHisLane: string;
  onAirStyle: string;
  theVibe: string;
  theAudience: string;
  whatHeBrings: string;
  trustedFor: string;
  signatureQuote: string;
}

export const djs: DjProfile[] = [
  {
    slug: 'bellamy-tha-blueprint',
    name: 'Bellamy',
    onAirName: 'Bellamy tha Blueprint',
    title: 'The architect of the vibe',
    schedule: 'Weekend DJ · Saturday 6PM–10PM',
    portrait: '/djs/bellamy-tha-blueprint.jpg',
    about: '[PLACEHOLDER] About Bellamy — background, how he got into radio, what brought him to HLYST.',
    inHisLane: '[PLACEHOLDER] R&B, neo-soul, contemporary soul.',
    onAirStyle: '[PLACEHOLDER] Smooth, measured pacing, dry humor, deep music knowledge.',
    theVibe: '[PLACEHOLDER] Late-evening wind-down, the sound of a Saturday night settling in.',
    theAudience: '[PLACEHOLDER] Who tunes in for this show and why.',
    whatHeBrings: '[PLACEHOLDER] His signature contribution to the station.',
    trustedFor: '[PLACEHOLDER] What listeners count on him for, every time.',
    signatureQuote: '[PLACEHOLDER — his catchphrase or a real quote from him]',
  },
  {
    slug: 'winslow-the-cypher',
    name: 'Winslow',
    onAirName: 'Winslow the Cypher',
    title: '[PLACEHOLDER title]',
    schedule: '[PLACEHOLDER schedule]',
    portrait: '/djs/winslow-the-cypher.jpg',
    about: '[PLACEHOLDER]',
    inHisLane: '[PLACEHOLDER] Hip-hop, boom bap, conscious rap, spoken word.',
    onAirStyle: '[PLACEHOLDER] Direct, high energy, culture-deep.',
    theVibe: '[PLACEHOLDER]',
    theAudience: '[PLACEHOLDER]',
    whatHeBrings: '[PLACEHOLDER]',
    trustedFor: '[PLACEHOLDER]',
    signatureQuote: '[PLACEHOLDER]',
  },
  {
    slug: 'uncle-ray',
    name: 'Uncle Ray',
    onAirName: 'Uncle Ray',
    title: '[PLACEHOLDER title]',
    schedule: '[PLACEHOLDER schedule]',
    portrait: '/djs/uncle-ray.jpg',
    about: '[PLACEHOLDER]',
    inHisLane: '[PLACEHOLDER]',
    onAirStyle: '[PLACEHOLDER] Warm, relaxed, deep history, storytelling.',
    theVibe: '[PLACEHOLDER]',
    theAudience: '[PLACEHOLDER]',
    whatHeBrings: '[PLACEHOLDER]',
    trustedFor: '[PLACEHOLDER]',
    signatureQuote: '[PLACEHOLDER]',
  },
  {
    slug: 'lady-t',
    name: 'Lady T',
    onAirName: 'Lady T',
    title: '[PLACEHOLDER title]',
    schedule: '[PLACEHOLDER schedule]',
    portrait: '/djs/lady-t.jpg',
    about: '[PLACEHOLDER]',
    inHisLane: '[PLACEHOLDER]',
    onAirStyle: '[PLACEHOLDER]',
    theVibe: '[PLACEHOLDER]',
    theAudience: '[PLACEHOLDER]',
    whatHeBrings: '[PLACEHOLDER]',
    trustedFor: '[PLACEHOLDER]',
    signatureQuote: '[PLACEHOLDER]',
  },
  {
    slug: 'eric-jordan',
    name: 'Eric Jordan',
    onAirName: 'Eric Jordan',
    title: '[PLACEHOLDER title]',
    schedule: '[PLACEHOLDER schedule]',
    portrait: '/djs/eric-jordan.jpg',
    about: '[PLACEHOLDER]',
    inHisLane: '[PLACEHOLDER]',
    onAirStyle: '[PLACEHOLDER]',
    theVibe: '[PLACEHOLDER]',
    theAudience: '[PLACEHOLDER]',
    whatHeBrings: '[PLACEHOLDER]',
    trustedFor: '[PLACEHOLDER]',
    signatureQuote: '[PLACEHOLDER]',
  },
  {
    slug: 'nicole-james',
    name: 'Nicole James',
    onAirName: 'Nicole James',
    title: '[PLACEHOLDER title]',
    schedule: '[PLACEHOLDER schedule]',
    portrait: '/djs/nicole-james.jpg',
    about: '[PLACEHOLDER]',
    inHisLane: '[PLACEHOLDER]',
    onAirStyle: '[PLACEHOLDER]',
    theVibe: '[PLACEHOLDER]',
    theAudience: '[PLACEHOLDER]',
    whatHeBrings: '[PLACEHOLDER]',
    trustedFor: '[PLACEHOLDER]',
    signatureQuote: '[PLACEHOLDER]',
  },
];

export function getDjBySlug(slug: string): DjProfile | undefined {
  return djs.find(d => d.slug === slug);
}
