// Unit tests for skills/config-fields.ts — the declaration a skill's tool.mjs
// makes about its own operator-editable knobs.
//
// The bug (issue #1300, bug 11): the News feed field was gated on a hardcoded
// `isNews: kind === 'news'` in routes/dj.ts, with the UI section gated on that
// flag. Export the News skill, rename it in the .md and the .zip, re-import: the
// skill loads, airs, and its tool still reads `config.feed` — but no form field
// exists to set one, so a second news source was impossible. Worse, saving the
// renamed skill from the admin form REWRITES its SKILL.md, which dropped any
// `feed:` line a hand-edit had put there.
//
// The fix moves the declaration into tool.mjs (which a duplicate copies
// verbatim), so the knobs travel with the skill rather than with its name.
//
// Run: `tsx scripts/skill-config-fields.test.ts`.

import assert from 'node:assert/strict';
import {
  parseConfigFields,
  readConfigValues,
  coerceConfigValues,
  CONFIG_FIELDS_LIMIT,
} from '../src/skills/config-fields.js';

// The News built-in's actual declaration — the shape a duplicate inherits.
const NEWS_DECL = {
  feed: { type: 'url', label: 'News feed · RSS 2.0', placeholder: 'https://…/rss.xml' },
  feedMaxItems: { type: 'number', label: 'Max items', min: 1, max: 50, placeholder: '10' },
};

// ── the reported bug: a renamed copy keeps its knobs ─────────────────────────

{
  const fields = parseConfigFields(NEWS_DECL);
  assert.equal(fields.length, 2, 'both news knobs are declared');
  assert.deepEqual(fields.map(f => f.key), ['feed', 'feedMaxItems'], 'declaration order is preserved');
  assert.equal(fields[0].type, 'url');
  assert.equal(fields[1].type, 'number');
  assert.equal(fields[1].min, 1);
  assert.equal(fields[1].max, 50);

  // The renamed duplicate: same tool.mjs, different slug. Nothing about the
  // parse depends on the skill's name.
  const values = readConfigValues(fields, {
    name: 'tech-news',
    label: 'Tech headlines',
    feed: 'https://example.com/tech.xml',
    feedMaxItems: '6',
  });
  assert.deepEqual(
    values,
    { feed: 'https://example.com/tech.xml', feedMaxItems: 6 },
    'a renamed skill reads its own feed back out of its own frontmatter',
  );
}

// A save round-trips the form values, so rewriting SKILL.md can't silently drop
// the feed line.
{
  const fields = parseConfigFields(NEWS_DECL);
  const out = coerceConfigValues(fields, { feed: 'https://example.com/rss.xml', feedMaxItems: '8' });
  assert.deepEqual(out, { feed: 'https://example.com/rss.xml', feedMaxItems: 8 });
}

// ── declaration sanitising: malformed narrows to nothing, never throws ───────

{
  assert.deepEqual(parseConfigFields(undefined), []);
  assert.deepEqual(parseConfigFields(null), []);
  assert.deepEqual(parseConfigFields('feed'), []);
  assert.deepEqual(parseConfigFields(['feed']), []);
  assert.deepEqual(parseConfigFields({ feed: 'https://…' }), [], 'a non-object declaration is dropped');
}

// Reserved frontmatter keys can't be redeclared — writeSkillFile emits those
// from its own typed fields, so a collision would write the line twice.
{
  const fields = parseConfigFields({
    label: { type: 'text' },
    cooldown: { type: 'text' },
    tags: { type: 'text' },
    feed: { type: 'url' },
  });
  assert.deepEqual(fields.map(f => f.key), ['feed'], 'only the non-reserved key survives');
}

// Bad keys are dropped; an unknown type degrades to text; a missing label is
// derived from the key.
{
  const fields = parseConfigFields({
    '2bad': { type: 'text' },
    'has-hyphen': { type: 'text' },
    apiBase: { type: 'wat' },
  });
  assert.deepEqual(fields.map(f => f.key), ['apiBase']);
  assert.equal(fields[0].type, 'text', 'unknown type degrades to text');
  assert.equal(fields[0].label, 'Api Base', 'label derived from the key');
}

// The per-skill cap holds.
{
  const decl: Record<string, unknown> = {};
  for (let i = 0; i < CONFIG_FIELDS_LIMIT + 5; i++) decl[`k${i}`] = { type: 'text' };
  assert.equal(parseConfigFields(decl).length, CONFIG_FIELDS_LIMIT);
}

// ── value validation is LOUD (the route turns a throw into a 400) ────────────

{
  const fields = parseConfigFields(NEWS_DECL);
  assert.throws(() => coerceConfigValues(fields, { feed: 'not-a-url' }), /http\(s\) URL/);
  assert.throws(() => coerceConfigValues(fields, { feed: 'file:///etc/passwd' }), /http\(s\) URL/);
  assert.throws(() => coerceConfigValues(fields, { feedMaxItems: 'ten' }), /must be a number/);
  assert.throws(() => coerceConfigValues(fields, { feedMaxItems: '0' }), /at least 1/);
  assert.throws(() => coerceConfigValues(fields, { feedMaxItems: '500' }), /at most 50/);
}

// An empty/cleared value omits the key entirely — that's how the operator
// deletes a frontmatter line.
{
  const fields = parseConfigFields(NEWS_DECL);
  assert.deepEqual(coerceConfigValues(fields, { feed: '', feedMaxItems: '  ' }), {});
}

// Undeclared keys in the body are ignored — a client can't write arbitrary
// frontmatter through this path.
{
  const fields = parseConfigFields(NEWS_DECL);
  const out = coerceConfigValues(fields, { feed: 'https://example.com/a.xml', requiresKey: 'EVIL', brief: 'x' });
  assert.deepEqual(out, { feed: 'https://example.com/a.xml' });
}

// A text value carrying newlines is folded, not written raw — a frontmatter
// line is one flat `key: value`.
{
  const fields = parseConfigFields({ note: { type: 'text' } });
  assert.deepEqual(coerceConfigValues(fields, { note: 'one\ntwo' }), { note: 'one two' });
}

// A skill with no declaration persists nothing, whatever the body says.
{
  assert.deepEqual(coerceConfigValues([], { feed: 'https://example.com/a.xml' }), {});
  assert.deepEqual(readConfigValues([], { feed: 'https://example.com/a.xml' }), {});
}

// readConfigValues: an unset knob is ABSENT rather than empty, so the UI can
// tell "never configured" from "configured blank".
{
  const fields = parseConfigFields(NEWS_DECL);
  assert.deepEqual(readConfigValues(fields, { name: 'news' }), {});
  assert.deepEqual(readConfigValues(fields, null), {});
  assert.deepEqual(readConfigValues(fields, { feed: '   ' }), {}, 'a blank line reads as unset');
  assert.deepEqual(
    readConfigValues(fields, { feedMaxItems: 'lots' }),
    {},
    'an unparseable number is dropped rather than surfaced as NaN',
  );
}

console.log('skill-config-fields.test.ts — all assertions passed');
