// Pure show helpers: hydration, validation, and the payload / table-row
// projections.
//
// Hydration and validation both defer to the shared show schema
// (controller/src/schemas/show.ts, mirrored into lib/schemas.generated.ts), so
// the rules this panel applies are byte-for-byte the ones the controller
// enforces. What stays local is only what the schema deliberately does not
// express: the editor's tolerance for a half-finished show, and showPayload's
// "only means something with" conditionals.

import type { ShowFacet, ShowRow } from './ShowsTable';
import { SHOW_COLORS } from '../schedule/lib';
import { eraLabelOf } from './types';
import type { Persona, Schedule, Show } from './types';
import {
  migrateLegacyShowFields,
  showSchema,
  type ShowSchemaContext,
} from '@/lib/schemas.generated';


export function clientMintId() {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return 's_' + [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Fill in a show the editor can hold.
//
// Deliberately NOT a schema parse: the editor must be able to carry a
// half-finished show (a fresh one has no name and no host yet), and a parse
// would reject exactly that. What it does take from the schema is the legacy
// singular → plural coercion (#929) — migrateLegacyShowFields — so the browser
// and the controller's load path can't disagree about what an old `mood` or a
// comma-crammed `genre` becomes.
export function hydrateShow(s: Partial<Show>): Show {
  const m = migrateLegacyShowFields(s) as Partial<Show>;
  return {
    id: m.id ?? clientMintId(),
    name: m.name ?? '',
    topic: m.topic ?? '',
    personaId: m.personaId ?? '',
    guestPersonaIds: Array.isArray(m.guestPersonaIds) ? m.guestPersonaIds : [],
    banter: m.banter ?? false,
    moods: Array.isArray(m.moods) ? m.moods : [],
    themeId: m.themeId ?? '',
    genres: Array.isArray(m.genres) ? m.genres.map(g => String(g).trim()).filter(Boolean) : [],
    eras: Array.isArray(m.eras) ? m.eras : [],
    energies: Array.isArray(m.energies) ? m.energies : [],
    // Anything unrecognised reads as no constraint, matching the schema's own
    // vocals field — a steering filter that silently stops applying is a far
    // smaller failure than a show that stops playing music.
    vocals: m.vocals === 'instrumental' || m.vocals === 'vocal' ? m.vocals : '',
    filtersStrict: m.filtersStrict ?? false,
    maxTrackSeconds: m.maxTrackSeconds ?? null,
    playlistIds: Array.isArray(m.playlistIds) ? m.playlistIds : [],
    playlistStrict: m.playlistStrict ?? false,
    excludedPlaylistIds: Array.isArray(m.excludedPlaylistIds) ? m.excludedPlaylistIds : [],
    programme: m.programme ?? false,
    segmentSkill: m.segmentSkill ?? '',
  };
}

export function emptyWeek(): Schedule {
  const w: Schedule = {};
  for (let d = 0; d < 7; d++) w[d] = Array(24).fill(null);
  return w;
}

export function abbrev(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

/**
 * The show schema's context, from what the panel already has loaded.
 *
 * Every field is a real check here — unlike the controller's LOAD path, the
 * panel holds the live roster, the live mood vocabulary and the live theme
 * list, so it can answer all four questions the server will ask.
 */
export function showContext(opts: {
  personas: Persona[];
  moods: string[];
  themeIds: string[];
  minTrackSeconds: number | null;
}): ShowSchemaContext {
  return {
    personaIds: opts.personas.map(p => p.id),
    moodNames: opts.moods,
    themeIds: opts.themeIds,
    minTrackSeconds: opts.minTrackSeconds,
  };
}

// showSchema() is a heavyweight factory (~20 field pipelines), and the panel
// judges every row on every render — one build per CALL turned a 30-show rack
// into 30 schema constructions per keystroke while the editor was open. The
// context is identity-stable (ShowsPanel memoises it and hands the same object
// to the rows AND the editor), so a one-slot cache keyed on that identity makes
// every caller share one schema instance.
let cachedCtx: ShowSchemaContext | null = null;
let cachedSchema: ReturnType<typeof showSchema> | null = null;
function schemaFor(ctx: ShowSchemaContext) {
  if (cachedSchema == null || ctx !== cachedCtx) {
    cachedCtx = ctx;
    cachedSchema = showSchema(ctx);
  }
  return cachedSchema;
}

/**
 * Would the controller accept this show?
 *
 * Runs the shared schema rather than restating three of its rules, which is
 * what this used to do (name length, host present, brief length) — so the
 * editor's badge and Save gate now also catch an era window that ends before it
 * starts, a track cap under the station's crossfade floor, a guest who is also
 * the host, and every cap. It can only ever prevent a save the server was going
 * to reject.
 *
 * Mood is still not required: an empty list means "Any", and the autonomous
 * mood applies while the show is on air.
 */
export function showValid(s: Show, ctx: ShowSchemaContext): boolean {
  return schemaFor(ctx).safeParse(s).success;
}

/**
 * Per-field messages for the same parse, keyed by the schema's field name.
 * The editor footer reads the first of these when Save is gated, so the
 * diagnosis is whatever the schema actually objected to — not a hard-coded
 * guess about names and personas.
 */
export function showFieldErrors(s: Show, ctx: ShowSchemaContext): Record<string, string> {
  const r = schemaFor(ctx).safeParse(s);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.');
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

// At least one music filter set — the Strict filter toggle only means
// something when there's a filter for it to harden.
export function hasAnyMusicFilter(s: Show): boolean {
  return !!(s.moods.length || s.genres.length || s.energies.length || s.eras.length || s.vocals);
}

// Trimmed, with the "only-means-something-with" conditionals the server also
// enforces. Shared by Save show (POST /shows) and the community install path.
export function showPayload(s: Show) {
  return {
    id: s.id,
    name: s.name.trim(),
    topic: s.topic.trim(),
    personaId: s.personaId,
    // The host can be switched after guests were picked; the server rejects a
    // guest that duplicates the host, so filter it here too.
    guestPersonaIds: (s.guestPersonaIds || []).filter(id => id !== s.personaId),
    // Banter only means something with guests in the studio.
    banter: (s.guestPersonaIds?.length ?? 0) > 0 && s.banter,
    moods: s.moods,
    themeId: s.themeId || '',
    genres: s.genres.map(g => g.trim()).filter(Boolean),
    eras: s.eras,
    energies: s.energies,
    vocals: s.vocals || '',
    // Strict only means something with at least one music filter set.
    filtersStrict: hasAnyMusicFilter(s) && s.filtersStrict,
    maxTrackSeconds: s.maxTrackSeconds,
    playlistIds: s.playlistIds || [],
    // Strict only means something with at least one playlist pinned.
    playlistStrict: (s.playlistIds?.length ?? 0) > 0 && s.playlistStrict,
    excludedPlaylistIds: s.excludedPlaylistIds || [],
    programme: s.programme ?? false,
    // A skill pin only means something in programme mode.
    segmentSkill: s.programme ? (s.segmentSkill || '') : '',
  };
}


// The visual counterpart to the text showFilterSummary(). Shared by the slate card
// and the table row so the two views can't drift.
export function showFacets(s: Show): ShowFacet[] {
  const facets: ShowFacet[] = [];
  if (s.moods.length) s.moods.forEach(m => facets.push({ key: `mood-${m}`, label: m }));
  else facets.push({ key: 'mood-any', label: 'any mood' });
  s.genres.forEach(g => facets.push({ key: `genre-${g}`, label: g }));
  s.eras.forEach((e, idx) => facets.push({ key: `era-${idx}`, label: eraLabelOf(e) }));
  s.energies.forEach(en => facets.push({ key: `energy-${en}`, label: en }));
  if (s.vocals) facets.push({ key: 'vocals', label: s.vocals === 'instrumental' ? 'instrumental' : 'vocals' });
  if (s.filtersStrict && hasAnyMusicFilter(s)) facets.push({ key: 'strict', label: 'strict', accent: true });
  const nPl = s.playlistIds?.length ?? 0;
  if (nPl) facets.push({ key: 'playlists', label: `${nPl} playlist${nPl > 1 ? 's' : ''}${s.playlistStrict ? ' · strict' : ''}` });
  const nEx = s.excludedPlaylistIds?.length ?? 0;
  if (nEx) facets.push({ key: 'excluded', label: `${nEx} excluded` });
  if (s.maxTrackSeconds != null) {
    facets.push({ key: 'length', label: s.maxTrackSeconds === 0 ? 'any length' : `≤${s.maxTrackSeconds}s` });
  }
  return facets;
}

// Grammatical name join: "Kai", "Kai & Rae", "Kai, Rae & Sol".
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

// `index` is carried on the row because the panel keys colour and editing off the
// show's position in the array.
function faceOf(p: Persona, apiBase: string) {
  return {
    key: p.id,
    initials: abbrev(p.name?.trim() || ''),
    src: p.avatar ? `${apiBase}/persona-avatar/${encodeURIComponent(p.id)}` : null,
  };
}

// Everything the row needs is derived here, so ShowsTable never sees `Show`.
export function showRow(
  s: Show,
  index: number,
  personas: Persona[],
  apiBase: string,
  hrs: number,
  ctx: ShowSchemaContext,
): ShowRow {
  const host = personas.find(p => p.id === s.personaId) ?? null;
  const guests = (s.guestPersonaIds || [])
    .map(id => personas.find(p => p.id === id))
    .filter((p): p is Persona => Boolean(p));
  return {
    id: s.id,
    index,
    name: s.name.trim(),
    colour: SHOW_COLORS[index % SHOW_COLORS.length] ?? '#000',
    programme: !!s.programme,
    skillPin: s.programme && s.segmentSkill ? s.segmentSkill : '',
    banter: !!s.banter,
    host: host ? faceOf(host, apiBase) : null,
    hostName: host ? (host.name?.trim() || 'Unnamed') : (s.personaId ? 'Unnamed' : ''),
    guests: guests.map(g => faceOf(g, apiBase)),
    guestNames: joinNames(guests.map(g => g.name?.trim() || 'Unnamed')),
    facets: showFacets(s),
    hrs,
    ok: showValid(s, ctx),
  };
}


