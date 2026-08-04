// Operator-editable config fields a skill declares for ITSELF.
//
// A skill's tool.mjs may export `configFields` — a flat
// `{ key: { type, label, … } }` map describing the knobs the operator should be
// able to set from /admin/skills. The values live in the skill's own SKILL.md
// frontmatter, which the loader already hands the tool as its 4th argument
// (`config`), so a declared field is readable by the tool with no extra wiring.
//
// This exists because the News feed field used to be gated on a hardcoded
// `kind === 'news'` string in routes/dj.ts. Export a news skill, rename it, and
// re-import: the tool still read `config.feed`, but nothing in the UI would set
// one — so a second news source was impossible (issue #1300, bug 11). The
// declaration rides in tool.mjs, which a duplicate copies verbatim, so a renamed
// skill keeps its knobs by construction. Any skill can now carry settings; none
// of them need a route or a form field of their own.
//
// Everything here is pure — the unit-test seam is scripts/skill-config-fields.test.ts.

// Frontmatter keys the loader/scaffold own. A skill may not redeclare one as a
// config field: writeSkillFile emits those from its own typed fields, so a
// collision would either be silently dropped or write the line twice.
export const RESERVED_CONFIG_KEYS = new Set([
  'name', 'label', 'cooldown', 'context', 'contextFields',
  'window', 'requiresKey', 'tags', 'toolDescription',
]);

export const CONFIG_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,32}$/;
export const CONFIG_FIELDS_LIMIT = 8;
const TEXT_MAX = 300;

export type SkillConfigFieldType = 'text' | 'url' | 'number';

export interface SkillConfigField {
  key: string;
  type: SkillConfigFieldType;
  label: string;
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
}

export type SkillConfigValues = Record<string, string | number>;

function titleCaseKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase());
}

function optionalString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.replace(/[\r\n]+/g, ' ').trim();
  return s ? s.slice(0, 160) : undefined;
}

function optionalNumber(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// Sanitise a tool.mjs `configFields` export. Same posture as the sibling
// `inputs` export (loader.ts sanitizeToolInputs): a malformed declaration
// narrows to nothing rather than breaking the skill — the skill still loads and
// still airs, it just carries no operator knobs.
export function parseConfigFields(raw: unknown): SkillConfigField[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const out: SkillConfigField[] = [];
  for (const [key, decl] of Object.entries(raw as Record<string, unknown>)) {
    if (!CONFIG_KEY_RE.test(key) || RESERVED_CONFIG_KEYS.has(key)) continue;
    if (!decl || typeof decl !== 'object' || Array.isArray(decl)) continue;
    const d = decl as Record<string, unknown>;
    const type: SkillConfigFieldType =
      d.type === 'url' || d.type === 'number' ? d.type : 'text';
    const field: SkillConfigField = {
      key,
      type,
      label: optionalString(d.label) || titleCaseKey(key),
    };
    const placeholder = optionalString(d.placeholder);
    if (placeholder) field.placeholder = placeholder;
    const hint = optionalString(d.hint);
    if (hint) field.hint = hint;
    if (type === 'number') {
      const min = optionalNumber(d.min);
      const max = optionalNumber(d.max);
      if (min !== undefined) field.min = min;
      if (max !== undefined) field.max = max;
    }
    out.push(field);
    if (out.length >= CONFIG_FIELDS_LIMIT) break;
  }
  return out;
}

// Current values for the declared fields, read out of the skill's frontmatter
// (which the loader parses as flat strings). A key with no frontmatter line is
// absent from the result, so the UI can tell "unset" from "set to empty".
export function readConfigValues(
  fields: SkillConfigField[],
  frontmatter: Record<string, unknown> | null | undefined,
): SkillConfigValues {
  const out: SkillConfigValues = {};
  if (!frontmatter) return out;
  for (const f of fields) {
    const raw = frontmatter[f.key];
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (!s) continue;
    if (f.type === 'number') {
      const n = parseInt(s, 10);
      if (Number.isFinite(n)) out[f.key] = n;
      continue;
    }
    out[f.key] = s;
  }
  return out;
}

// Validate a form/API submission against the declaration. LOUD, like buildTags:
// a bad value throws so the route 400s instead of silently dropping the knob the
// operator just set. Undeclared keys in the body are ignored (never written), an
// empty value clears the frontmatter line.
export function coerceConfigValues(
  fields: SkillConfigField[],
  body: unknown,
): SkillConfigValues {
  const out: SkillConfigValues = {};
  if (!fields.length) return out;
  const input = (body && typeof body === 'object' && !Array.isArray(body))
    ? (body as Record<string, unknown>)
    : {};
  for (const f of fields) {
    const raw = input[f.key];
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (!s) continue; // cleared — omit the line entirely

    if (f.type === 'number') {
      const n = parseInt(s, 10);
      if (!Number.isFinite(n)) throw new Error(`${f.key} must be a number`);
      if (f.min !== undefined && n < f.min) throw new Error(`${f.key} must be at least ${f.min}`);
      if (f.max !== undefined && n > f.max) throw new Error(`${f.key} must be at most ${f.max}`);
      out[f.key] = n;
      continue;
    }

    if (f.type === 'url') {
      let u: URL;
      try {
        u = new URL(s);
      } catch {
        throw new Error(`${f.key} must be an http(s) URL`);
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error(`${f.key} must be an http(s) URL`);
      }
      out[f.key] = s;
      continue;
    }

    // text — a frontmatter line is one flat `key: value`, so a newline would
    // corrupt the block. Fold rather than reject: the operator pasted a value,
    // not markup.
    const flat = s.replace(/[\r\n]+/g, ' ').trim();
    if (flat.length > TEXT_MAX) throw new Error(`${f.key} must be at most ${TEXT_MAX} characters`);
    out[f.key] = flat;
  }
  return out;
}
