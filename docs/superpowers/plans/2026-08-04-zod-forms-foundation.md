# Zod Validation + shadcn Form Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one shared zod schema per validated shape, executed on both the controller and the web form layer, proven end-to-end on the Webhooks feature.

**Architecture:** Schemas live in `controller/src/schemas/` and may import only from `zod`. A generator mirrors them verbatim into `web/lib/schemas.generated.ts`, kept honest by a CI drift check — the same mechanism `gen-theme-tokens.ts` already uses. Stateful rules (redaction sentinels, id minting, cross-item dedupe) stay in a server-only sibling module so the mirrored file remains browser-safe. `settings.update()` remains the authoritative persistence chokepoint; the new route middleware is an earlier, field-level check that produces better form errors.

**Tech Stack:** zod 4.4.3, react-hook-form 7.84.0, @hookform/resolvers 5.7.1, existing shadcn `Field` primitives, Express, Next 16 / React 19, Tailwind v4.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-04-zod-forms-foundation-design.md`.
- **zod version must match on both sides:** controller has `^4.4.3`; web must use `^4.4.3`.
- **`controller/src/schemas/*.ts` (excluding `*-server.ts`) may import ONLY from `zod`.** No node builtins, no project modules. This is what makes verbatim mirroring safe.
- **`validateWebhooksStrict` keeps its exact name, signature `(raw: unknown, existing: Webhook[] = [])`, and throwing behaviour.** Its thrown *message text* is allowed to change (zod wording); its accept/reject decisions are not.
- **Do not add `web/components/ui/form.tsx`.** Use the already-vendored `Field` primitives in `web/components/ui/field.tsx`.
- **Do not run the shadcn CLI.** It emits Tailwind-v3 CSS-variable syntax that breaks this project's v4 setup.
- **Never run `npm run build` in `web/` while a dev server is running** — it corrupts `.next` and yields 500s on dynamic routes.
- **Lint is the merge gate:** `npm run lint` (`eslint . && tsc --noEmit`) must pass in both `controller/` and `web/`.
- **Run `npm test` in `controller/` before pushing** — CI does not run it.
- **PR target is `develop`, never `main`.**
- **No "Generated with Claude Code" attribution** in commits or PR bodies.

---

### Task 1: Shared webhook schema + server-only rules, rewiring `validateWebhooksStrict`

**Files:**
- Create: `controller/src/schemas/webhook.ts`
- Create: `controller/src/schemas/webhook-server.ts`
- Create: `controller/scripts/schemas.test.ts`
- Modify: `controller/src/settings/validate.ts:544-590`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `WEBHOOK_EVENTS: readonly ['track.play','dj.say','dj.link','request.received']`
  - `WEBHOOKS_LIMIT: 16`
  - `webhookSchema`, `webhooksSchema`, `webhooksPatchSchema` (zod schemas)
  - `type Webhook = { id: string; url: string; events: string[]; enabled: boolean; authHeader: string }`
  - `type WebhookEvent`
  - `mergeWebhookSecrets(parsed: WebhookParsed[], existing: Webhook[]): Webhook[]` from `webhook-server.ts`

- [ ] **Step 1: Write the failing test**

Create `controller/scripts/schemas.test.ts`. Note the `STATE_DIR` redirect + dynamic import: `settings/validate.ts` imports `./store.js`, which is config-derived, so this mirrors `scripts/compat-tts-params.test.ts`.

```ts
// Webhook validation moved onto a shared zod schema (controller/src/schemas/).
// These tests pin the PUBLIC contract — validateWebhooksStrict's accept/reject
// decisions and returned shape — not the schema in isolation, because
// settings.update() is the caller that must not change behaviour.
//
// Thrown MESSAGE TEXT is deliberately not asserted: zod's wording differs from
// the old hand-rolled strings. Only accept-vs-reject and the returned object
// are contractual.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.STATE_DIR = mkdtempSync(path.join(tmpdir(), 'subwave-schemas-'));

const { validateWebhooksStrict } = await import('../src/settings/validate.js');
const { WEBHOOK_EVENTS, WEBHOOKS_LIMIT, webhooksPatchSchema } = await import(
  '../src/schemas/webhook.js'
);

const hook = (over = {}) => ({
  id: 'wh_aaa111',
  url: 'https://example.com/hook',
  events: ['track.play'],
  enabled: true,
  authHeader: '',
  ...over,
});

test('accepts a well-formed hook and returns the normalised shape', () => {
  const [h] = validateWebhooksStrict([hook()]);
  assert.equal(h.id, 'wh_aaa111');
  assert.equal(h.url, 'https://example.com/hook');
  assert.deepEqual(h.events, ['track.play']);
  assert.equal(h.enabled, true);
  assert.equal(h.authHeader, '');
});

test('rejects the inputs the hand-rolled validator rejected', () => {
  assert.throws(() => validateWebhooksStrict('nope' as unknown));
  assert.throws(() => validateWebhooksStrict([hook({ url: 'ftp://x.com' })]));
  assert.throws(() => validateWebhooksStrict([hook({ url: 'https://e.com/' + 'x'.repeat(500) })]));
  assert.throws(() => validateWebhooksStrict([hook({ events: [] })]));
  assert.throws(() => validateWebhooksStrict([hook({ events: ['not.a.real.event'] })]));
  assert.throws(() =>
    validateWebhooksStrict(Array.from({ length: WEBHOOKS_LIMIT + 1 }, () => hook({ id: undefined }))),
  );
});

test('trims the url and defaults enabled to true', () => {
  const [h] = validateWebhooksStrict([{ url: '  https://e.com/h  ', events: ['dj.say'] }]);
  assert.equal(h.url, 'https://e.com/h');
  assert.equal(h.enabled, true);
});

test('authHeader sentinel: "set" keeps the prior value', () => {
  const existing = [hook({ authHeader: 'Bearer real-secret' })];
  const [h] = validateWebhooksStrict([hook({ authHeader: 'set' })], existing);
  assert.equal(h.authHeader, 'Bearer real-secret');
});

test('authHeader sentinel: "set" with no prior value yields empty', () => {
  const [h] = validateWebhooksStrict([hook({ authHeader: 'set' })], []);
  assert.equal(h.authHeader, '');
});

test('authHeader: any other string replaces', () => {
  const existing = [hook({ authHeader: 'Bearer old' })];
  const [h] = validateWebhooksStrict([hook({ authHeader: 'Bearer new' })], existing);
  assert.equal(h.authHeader, 'Bearer new');
});

test('mints an id when absent and re-mints on collision', () => {
  const [a, b] = validateWebhooksStrict([
    hook({ id: undefined }),
    hook({ id: undefined }),
  ]);
  assert.match(a.id, /^wh_[a-z0-9]+$/);
  assert.notEqual(a.id, b.id);

  const [c, d] = validateWebhooksStrict([hook({ id: 'wh_dupe1' }), hook({ id: 'wh_dupe1' })]);
  assert.equal(c.id, 'wh_dupe1');
  assert.notEqual(d.id, 'wh_dupe1');
});

test('de-duplicates events, preserving first-seen order', () => {
  const [h] = validateWebhooksStrict([
    hook({ events: ['dj.link', 'track.play', 'dj.link'] }),
  ]);
  assert.deepEqual(h.events, ['dj.link', 'track.play']);
});

test('WEBHOOK_EVENTS holds exactly the four fan-out events', () => {
  assert.deepEqual([...WEBHOOK_EVENTS], [
    'track.play',
    'dj.say',
    'dj.link',
    'request.received',
  ]);
});

test('patch schema accepts each field independently', () => {
  // The route lets the listener gate save without re-submitting the hook list,
  // and vice versa. Both must stay optional.
  assert.equal(webhooksPatchSchema.safeParse({ webhooks: [hook()] }).success, true);
  assert.equal(webhooksPatchSchema.safeParse({ trackPlayListenerGated: true }).success, true);
  assert.equal(webhooksPatchSchema.safeParse({}).success, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd controller && npm test -- schemas`
Expected: FAIL — `Cannot find module '../src/schemas/webhook.js'`

- [ ] **Step 3: Create the shared schema module**

Create `controller/src/schemas/webhook.ts`. **This file may import only from `zod`** — it is mirrored verbatim into the browser bundle.

```ts
// Shared webhook schema — the single source of truth for the outbound-webhook
// shape, executed on BOTH sides. The controller runs it in
// settings.validate.validateWebhooksStrict() and in the route middleware; the
// browser runs the mirrored copy (web/lib/schemas.generated.ts) as the form
// resolver.
//
// HARD RULE: this file may import ONLY from 'zod'. It is copied verbatim into
// the web bundle, so a project import or a node builtin here breaks the mirror.
// Enforced by controller/eslint.config.mjs.
//
// Rules that are NOT pure functions of one value — the authHeader redaction
// sentinel, id minting, cross-item id de-duplication — deliberately live in
// webhook-server.ts, which is NOT mirrored.
import { z } from 'zod';

// Event names the outbound webhook fan-out can subscribe to. This is now the
// ONE definition; settings/vocab.ts and broadcast/webhooks.ts re-export it.
export const WEBHOOK_EVENTS = [
  'track.play',          // a track started playing
  'dj.say',              // station ID / weather / hourly — heavy-ducked voice
  'dj.link',             // between-track auto-DJ link — light-ducked voice
  'request.received',    // a listener submitted a request
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOKS_LIMIT = 16;

const ID_RE = /^[a-z0-9_]{3,32}$/;

export const webhookSchema = z.object({
  // Optional because a brand-new row has no id yet — the server mints one.
  id: z.string().regex(ID_RE).optional(),
  url: z
    .string()
    .trim()
    .max(500, 'URL must be 500 characters or fewer')
    .regex(/^https?:\/\//, 'URL must start with http:// or https://'),
  events: z
    .array(z.enum(WEBHOOK_EVENTS), { error: 'Pick at least one event' })
    .min(1, 'Pick at least one event')
    .transform((xs) => [...new Set(xs)]),
  enabled: z.boolean().default(true),
  // '' means no header. The literal 'set' is the redaction sentinel from
  // settings.getRedacted() meaning "keep whatever is stored" — resolving it
  // needs the CURRENT list, so see mergeWebhookSecrets() in webhook-server.ts.
  authHeader: z.string().max(500).default(''),
});

export type WebhookParsed = z.output<typeof webhookSchema>;
export type Webhook = WebhookParsed & { id: string };

export const webhooksSchema = z
  .array(webhookSchema)
  .max(WEBHOOKS_LIMIT, `At most ${WEBHOOKS_LIMIT} webhooks`);

// Both fields optional: the route lets the listener gate save on its own
// without re-submitting (and re-validating) the hook list, and vice versa.
export const webhooksPatchSchema = z.object({
  webhooks: webhooksSchema.optional(),
  trackPlayListenerGated: z.boolean().optional(),
});
```

- [ ] **Step 4: Create the server-only rules module**

Create `controller/src/schemas/webhook-server.ts`. This is NOT mirrored — it may import freely.

```ts
// Server-only webhook rules. These are the three things a schema cannot express
// because they are not pure functions of a single value:
//
//   1. the authHeader 'set' redaction sentinel  — needs the EXISTING list
//   2. id minting                                — a side effect
//   3. cross-item id de-duplication              — needs sibling awareness
//
// Keeping them out of schemas/webhook.ts is load-bearing: it is what lets that
// file be copied byte-for-byte into the browser bundle.
import { mintId } from '../settings/vocab.js';
import type { Webhook, WebhookParsed } from './webhook.js';

export function mergeWebhookSecrets(
  parsed: WebhookParsed[],
  existing: Webhook[] = [],
): Webhook[] {
  const byId = new Map(existing.map((h) => [h.id, h] as const));
  const seen = new Set<string>();

  return parsed.map((item) => {
    let id = item.id ?? mintId('wh_');
    if (seen.has(id)) id = mintId('wh_');
    seen.add(id);

    // 'set' from getRedacted() means "keep the stored value" — the UI never
    // re-sends the real header. Anything else replaces it.
    const prior = byId.get(id);
    let authHeader = item.authHeader;
    if (item.authHeader === 'set') {
      authHeader = prior?.authHeader ?? '';
    }

    return { ...item, id, authHeader };
  });
}
```

- [ ] **Step 5: Rewire `validateWebhooksStrict` onto the schema**

In `controller/src/settings/validate.ts`, replace the body of `validateWebhooksStrict` (lines 544-590) with the two-step call. Keep the exported name and signature — `settings.ts:2071` calls it and must not change.

```ts
// Strict validator — used by update(). Shape and format now come from the
// shared schema (controller/src/schemas/webhook.ts), which the web form runs
// too; the stateful rules (redaction sentinel, id minting, cross-item dedupe)
// come from its server-only sibling. `existing` is the current list, so the
// operator can keep a previously-set authHeader by sending the redacted
// sentinel back unchanged.
export function validateWebhooksStrict(raw: unknown, existing: Webhook[] = []) {
  const parsed = webhooksSchema.parse(raw);
  return mergeWebhookSecrets(parsed, existing);
}
```

Add the imports near the existing import block at the top of the file:

```ts
import { webhooksSchema } from '../schemas/webhook.js';
import { mergeWebhookSecrets } from '../schemas/webhook-server.js';
```

Then remove the now-unused locals that only `validateWebhooksStrict` used. Check each with `grep -n` before deleting — `ID_RE` and `mintId` are used by other validators in this file and must stay imported.

Run: `grep -n "WEBHOOKS_LIMIT\|WEBHOOK_EVENTS" controller/src/settings/validate.ts`
If either has no remaining use in the file, drop it from the import list at line 7.

- [ ] **Step 6: Point `vocab.ts` and `broadcast/webhooks.ts` at the schema**

In `controller/src/settings/vocab.ts`, delete the `WEBHOOK_EVENTS` array (line 1039) and the `Webhook` interface (line 891), replacing both with re-exports. This removes duplications 1 and 4 from the spec's table.

```ts
// Webhook shape + event list now live in the shared schema, which the web form
// runs too (controller/src/schemas/webhook.ts). Re-exported here so the many
// existing importers of `Webhook` / `WEBHOOK_EVENTS` from vocab keep working.
export {
  WEBHOOK_EVENTS,
  WEBHOOKS_LIMIT,
  type Webhook,
  type WebhookEvent,
} from '../schemas/webhook.js';
```

Delete the existing `export const WEBHOOKS_LIMIT = 16;` at line 823 — it now comes from the schema.

In `controller/src/broadcast/webhooks.ts`, delete the `WEBHOOK_EVENTS` array (line 19), the `WebhookEvent` type (line 26), and the `WebhookConfig` interface (line 28). Replace with:

```ts
// One definition, shared with the web form — see controller/src/schemas/webhook.ts.
export { WEBHOOK_EVENTS, type WebhookEvent } from '../schemas/webhook.js';
import type { Webhook } from '../schemas/webhook.js';
```

Then replace every `WebhookConfig` reference in that file with `Webhook`:
Run: `grep -n "WebhookConfig" controller/src/broadcast/webhooks.ts` and update each hit.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd controller && npm test -- schemas`
Expected: PASS — 10 tests.

- [ ] **Step 8: Run the full suite and lint for regressions**

Run: `cd controller && npm test && npm run lint`
Expected: PASS. The full suite matters here because `Webhook` and `WEBHOOK_EVENTS` moved; any stale importer surfaces as a `tsc --noEmit` error.

- [ ] **Step 9: Commit**

```bash
git add controller/src/schemas/ controller/scripts/schemas.test.ts \
        controller/src/settings/validate.ts controller/src/settings/vocab.ts \
        controller/src/broadcast/webhooks.ts
git commit -m "refactor(controller): move webhook validation onto a shared zod schema"
```

---

### Task 2: ESLint import restriction + schema mirror generator + CI drift check

**Files:**
- Modify: `controller/eslint.config.mjs`
- Create: `controller/scripts/gen-schemas.ts`
- Modify: `controller/package.json` (scripts)
- Create: `web/lib/schemas.generated.ts` (generated output, committed)
- Modify: `.github/workflows/lint.yml`

**Interfaces:**
- Consumes: `controller/src/schemas/webhook.ts` from Task 1.
- Produces: `web/lib/schemas.generated.ts` exporting `WEBHOOK_EVENTS`, `WEBHOOKS_LIMIT`, `webhookSchema`, `webhooksSchema`, `webhooksPatchSchema`, `type Webhook`, `type WebhookEvent`, `type WebhookParsed` — consumed by Tasks 4 and 5.

- [ ] **Step 1: Add the import restriction that keeps the mirror safe**

In `controller/eslint.config.mjs`, add a scoped block after the existing rules block. Without this, the "only import zod" rule is a comment nobody enforces.

```js
  {
    // Files under src/schemas/ are mirrored verbatim into the web bundle by
    // scripts/gen-schemas.ts, so they must not reach for anything the browser
    // cannot resolve. *-server.ts is the escape hatch and is NOT mirrored.
    files: ['src/schemas/*.ts'],
    ignores: ['src/schemas/*-server.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*'],
              message:
                'src/schemas/* is mirrored into the browser — import only from "zod". Put anything else in a *-server.ts sibling.',
            },
          ],
          allow: ['zod'],
        },
      ],
    },
  },
```

Note: `allow` sits alongside `patterns` in the same options object.

- [ ] **Step 2: Verify the restriction actually fires**

Temporarily add `import { readFileSync } from 'node:fs';` to the top of `controller/src/schemas/webhook.ts`.

Run: `cd controller && npx eslint src/schemas/webhook.ts`
Expected: FAIL with the "import only from zod" message.

Now remove that temporary import line and re-run:
Run: `cd controller && npx eslint src/schemas/webhook.ts`
Expected: PASS, no output.

- [ ] **Step 3: Write the generator**

Create `controller/scripts/gen-schemas.ts`, modelled on `gen-theme-tokens.ts`.

```ts
// Generates web/lib/schemas.generated.ts from controller/src/schemas/*.ts, so
// the admin forms validate against the exact schema the controller enforces.
// The web package can't import controller/src at build time (separate package +
// build context), hence a checked-in mirror kept honest by CI — the same
// mechanism as gen-theme-tokens.ts.
//
//   cd controller && npm run gen:schemas
//
// The lint workflow re-runs this and `git diff --exit-code`s the output, so a
// schema change without a regenerate fails CI.
//
// Only pure schema modules are mirrored. *-server.ts siblings hold the rules
// that need server state and are deliberately excluded.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src', 'schemas');
const OUT = join(HERE, '..', '..', 'web', 'lib', 'schemas.generated.ts');

const files = readdirSync(SRC)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('-server.ts'))
  .sort();

const parts = files.map((f) => {
  const raw = readFileSync(join(SRC, f), 'utf8');
  // Output is ONE file, so per-module zod imports would collide. Drop them and
  // emit a single import at the top instead.
  const stripped = raw
    .split('\n')
    .filter((line) => !/^import\s.*from\s+'zod';\s*$/.test(line))
    .join('\n')
    .trim();
  return `// ─── from controller/src/schemas/${f} ${'─'.repeat(Math.max(0, 40 - f.length))}\n\n${stripped}`;
});

const body = `// GENERATED FILE — do not edit by hand.
// Mirror of controller/src/schemas/*.ts. Regenerate with:
//   cd controller && npm run gen:schemas
// CI fails if this drifts from the controller schemas.
//
// These are the SAME schemas the controller enforces. The form resolver and the
// route middleware therefore cannot disagree.

import { z } from 'zod';

${parts.join('\n\n')}
`;

writeFileSync(OUT, body);
console.log(`wrote ${OUT} (${files.length} module${files.length === 1 ? '' : 's'})`);
```

- [ ] **Step 4: Register the script and generate the mirror**

In `controller/package.json`, add to `scripts`, directly after `"gen:themes"`:

```json
    "gen:schemas": "tsx scripts/gen-schemas.ts"
```

Run: `cd controller && npm run gen:schemas`
Expected: `wrote /…/web/lib/schemas.generated.ts (1 module)`

- [ ] **Step 5: Verify the mirror is valid, importable TypeScript**

Run: `cd web && npx tsc --noEmit lib/schemas.generated.ts`
Expected: PASS. If it reports "Cannot find module 'zod'", that is expected until Task 4 adds the dependency — in that case confirm the file's *shape* instead and move on:

Run: `head -20 web/lib/schemas.generated.ts && grep -c "^export" web/lib/schemas.generated.ts`
Expected: the do-not-edit header, one `import { z } from 'zod';`, and 6 or more `export` lines.

- [ ] **Step 6: Add the CI drift check**

In `.github/workflows/lint.yml`, add a step immediately after the existing "Verify theme-token mirror is up to date" step, before `- run: npm run lint`:

```yaml
      # The web schema mirror (web/lib/schemas.generated.ts) is generated from
      # controller/src/schemas/**. Regenerate and fail on any drift, so a schema
      # change can't ship without regenerating the mirror the forms validate on.
      - name: Verify schema mirror is up to date
        if: matrix.package == 'controller'
        run: |
          npm run gen:schemas
          git diff --exit-code ../web/lib/schemas.generated.ts
```

- [ ] **Step 7: Prove the drift check would catch a real drift**

```bash
printf '\n// drift probe\n' >> web/lib/schemas.generated.ts
cd controller && npm run gen:schemas && git diff --exit-code ../web/lib/schemas.generated.ts; echo "exit=$?"
```
Expected: `exit=0` — the regenerate overwrote the probe, which is exactly the intended behaviour (CI regenerates *then* diffs, so any hand-edit is erased and any missing regenerate shows as a diff).

Now prove the inverse — a schema change without a regenerate:
```bash
sed -i 's/At most \${WEBHOOKS_LIMIT} webhooks/At most \${WEBHOOKS_LIMIT} hooks/' controller/src/schemas/webhook.ts
cd controller && npm run gen:schemas && git diff --exit-code ../web/lib/schemas.generated.ts; echo "exit=$?"
```
Expected: `exit=1` with a diff — CI would fail. Now revert both:
```bash
git checkout controller/src/schemas/webhook.ts && cd controller && npm run gen:schemas
```

- [ ] **Step 8: Lint and commit**

Run: `cd controller && npm run lint`
Expected: PASS.

```bash
git add controller/eslint.config.mjs controller/scripts/gen-schemas.ts \
        controller/package.json web/lib/schemas.generated.ts .github/workflows/lint.yml
git commit -m "build(controller): mirror shared schemas into web, drift-checked in CI"
```

---

### Task 3: `validateBody` middleware + webhook route wiring

**Files:**
- Create: `controller/src/middleware/validate.ts`
- Create: `controller/scripts/validate-middleware.test.ts`
- Modify: `controller/src/routes/webhooks.ts:40-62`

**Interfaces:**
- Consumes: `webhooksPatchSchema` from Task 1.
- Produces: `validateBody(schema)` — an Express middleware. On failure responds `400 { error: string, fieldErrors: Record<string, string> }`. On success replaces `req.body` with the parsed value and calls `next()`.

- [ ] **Step 1: Write the failing test**

Create `controller/scripts/validate-middleware.test.ts`. This tests the pure helpers directly — no HTTP server needed, so the test stays fast and has no port dependency.

```ts
// The route-boundary body validator. The error payload is deliberately
// ADDITIVE: `error` stays a flat human-readable string (every existing client
// reads exactly that from a 400), and `fieldErrors` is new.
import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

const { firstMessage, flattenIssues } = await import('../src/middleware/validate.js');

const schema = z.object({
  webhooks: z
    .array(z.object({ url: z.string().regex(/^https?:\/\//, 'URL must start with http:// or https://') }))
    .optional(),
});

test('flattenIssues keys errors by dotted field path', () => {
  const r = schema.safeParse({ webhooks: [{ url: 'https://ok.com' }, { url: 'nope' }] });
  assert.equal(r.success, false);
  assert.deepEqual(flattenIssues(r.error), {
    'webhooks.1.url': 'URL must start with http:// or https://',
  });
});

test('firstMessage returns a flat human-readable string', () => {
  const r = schema.safeParse({ webhooks: [{ url: 'nope' }] });
  assert.equal(r.success, false);
  assert.equal(firstMessage(r.error), 'URL must start with http:// or https://');
});

test('firstMessage prefixes the path when the message alone is ambiguous', () => {
  const r = schema.safeParse({ webhooks: 'notanarray' });
  assert.equal(r.success, false);
  // Path-prefixed, because "expected array, received string" alone tells the
  // operator nothing about WHICH field is wrong.
  assert.match(firstMessage(r.error), /^webhooks: /);
});

test('flattenIssues keeps only the first error per field', () => {
  const two = z.object({ url: z.string().min(5, 'too short').regex(/^https/, 'bad scheme') });
  const r = two.safeParse({ url: 'ftp' });
  assert.equal(r.success, false);
  assert.equal(Object.keys(flattenIssues(r.error)).length, 1);
  assert.equal(flattenIssues(r.error)['url'], 'too short');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd controller && npm test -- validate-middleware`
Expected: FAIL — `Cannot find module '../src/middleware/validate.js'`

- [ ] **Step 3: Write the middleware**

Create `controller/src/middleware/validate.ts`.

```ts
// Route-boundary body validation against a shared zod schema.
//
// This is NOT a replacement for settings.update()'s own validation —
// update() is reached by paths that never touch a route (backup import,
// onboarding save) and remains the authoritative chokepoint. This middleware
// runs EARLIER and produces a field-level error payload the admin form can map
// back onto individual inputs.
//
// The error contract is additive: `error` is the flat string every existing
// client already reads from a 400; `fieldErrors` is new and optional.
import type { NextFunction, Request, Response } from 'express';
import type { ZodError, ZodType } from 'zod';

// Dotted path — 'webhooks.1.url' — which is also react-hook-form's setError
// field syntax, so the admin form can map these straight onto inputs.
function pathOf(issue: ZodError['issues'][number]): string {
  return issue.path.join('.');
}

export function flattenIssues(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = pathOf(issue);
    // First error per field wins — a field with three problems should surface
    // one message, not a stack of them.
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function firstMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid request body';
  const key = pathOf(issue);
  // Zod's built-in type messages ("expected array, received string") don't name
  // the field, so prefix the path when the message doesn't stand on its own.
  const standalone = issue.code !== 'invalid_type';
  return standalone || !key ? issue.message : `${key}: ${issue.message}`;
}

export function validateBody(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = schema.safeParse(req.body);
    if (!r.success) {
      return res.status(400).json({
        error: firstMessage(r.error),
        fieldErrors: flattenIssues(r.error),
      });
    }
    req.body = r.data;
    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd controller && npm test -- validate-middleware`
Expected: PASS — 4 tests.

- [ ] **Step 5: Wire the middleware into the webhooks route**

In `controller/src/routes/webhooks.ts`, add the imports:

```ts
import { validateBody } from '../middleware/validate.js';
import { webhooksPatchSchema } from '../schemas/webhook.js';
```

Change the `POST /webhooks` handler signature at line 40 to insert the middleware after `requireAdmin`:

```ts
router.post('/webhooks', requireAdmin, validateBody(webhooksPatchSchema), async (req, res) => {
```

Inside that handler, the manual `!== undefined` guards stay exactly as they are — the schema marks both fields optional, so an omitted key is still absent on `req.body` and the "toggle saves on its own" behaviour is unchanged. Only the `!!` coercion on `trackPlayListenerGated` becomes redundant (the schema already guarantees a boolean); leave it, it is harmless and defensive.

- [ ] **Step 6: Verify the route still round-trips both partial shapes**

Run: `cd controller && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add controller/src/middleware/validate.ts controller/scripts/validate-middleware.test.ts \
        controller/src/routes/webhooks.ts
git commit -m "feat(controller): validate webhook request bodies at the route boundary"
```

---

### Task 4: Web dependencies + `useZodForm` helper

**Files:**
- Modify: `web/package.json`
- Create: `web/lib/form.ts`

**Interfaces:**
- Consumes: `web/lib/schemas.generated.ts` from Task 2.
- Produces: `useZodForm(schema, defaultValues)` returning react-hook-form's `UseFormReturn`, and `applyServerFieldErrors(form, fieldErrors)` — both consumed by Task 5.

- [ ] **Step 1: Install the dependencies**

Note: this runs a full install inside the worktree, replacing the `node_modules` symlink. That is expected and only affects the worktree.

Run:
```bash
cd web && npm install zod@^4.4.3 react-hook-form@^7.84.0 @hookform/resolvers@^5.7.1
```
Expected: installs cleanly. `@hookform/resolvers@5.7.1` declares `zod: ^3.25.0 || ^4.0.0`, so zod 4.4.3 satisfies its peer range.

- [ ] **Step 2: Verify the mirror now type-checks against the real zod**

Run: `cd web && npx tsc --noEmit`
Expected: PASS. This is the first point at which `web/lib/schemas.generated.ts` is compiled against an installed zod.

- [ ] **Step 3: Write the form helper**

Create `web/lib/form.ts`.

```ts
// Thin react-hook-form + zod wiring, written once rather than in each of the
// ~78 admin forms.
//
// The schemas come from lib/schemas.generated.ts — the committed mirror of
// controller/src/schemas/**, kept honest by a CI drift check. So the rules this
// resolver enforces are byte-for-byte the rules the controller enforces.
//
// Note there is deliberately no ui/form.tsx: shadcn's Field primitives are
// already vendored at components/ui/field.tsx, and FieldError already accepts
// react-hook-form's { message } error shape.
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from 'react-hook-form';
import type { z } from 'zod';

export function useZodForm<S extends z.ZodType<FieldValues>>(
  schema: S,
  defaultValues: DefaultValues<z.input<S>>,
): UseFormReturn<z.input<S>> {
  return useForm<z.input<S>>({
    resolver: zodResolver(schema),
    defaultValues,
    // Validate as the operator types, so the Save button's disabled state
    // tracks validity without a submit attempt — matching the behaviour the
    // hand-rolled `valid()` predicate used to provide.
    mode: 'onChange',
  });
}

// Maps the controller's `fieldErrors` payload back onto individual inputs.
// The controller emits dotted paths ('webhooks.1.url'), which is exactly
// react-hook-form's setError field syntax — so a rule only the server can
// check still lands on the right input rather than in a toast.
export function applyServerFieldErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  fieldErrors: Record<string, string> | undefined,
): boolean {
  if (!fieldErrors) return false;
  const entries = Object.entries(fieldErrors);
  for (const [path, message] of entries) {
    form.setError(path as Path<T>, { type: 'server', message });
  }
  return entries.length > 0;
}
```

- [ ] **Step 4: Verify it compiles and lints**

Run: `cd web && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/lib/form.ts
git commit -m "feat(web): add zod + react-hook-form and the shared useZodForm helper"
```

---

### Task 5: Convert `WebhooksPanel` to react-hook-form + `Field`

**Files:**
- Modify: `web/components/admin/WebhooksPanel.tsx` (delete lines 17-23 and 46-51; rework the component body from line 216)

**Interfaces:**
- Consumes: `useZodForm`, `applyServerFieldErrors` (Task 4); `webhooksSchema`, `WEBHOOKS_LIMIT`, `type Webhook` (Task 2 mirror).
- Produces: nothing consumed downstream.

**Behaviour that must survive this conversion** — verify each in Step 6:
1. The listener-gate toggle persists the moment it is flipped, on its own request, and does **not** ride the hooks Save button. Unsaved row edits survive a toggle. (The comment at line 263 explains why.)
2. Save is disabled while any row is invalid.
3. Add is disabled at 16 rows.
4. A stored `authHeader` renders as an empty input with placeholder `(stored, leave blank to keep)`, and leaving it untouched keeps the stored secret.
5. "Send test" is disabled until the row has a URL.
6. The card title shows the URL, or `(new webhook)` in italics when blank.

- [ ] **Step 1: Replace the local types and the hand-rolled validity check**

Delete `interface Webhook` (lines 17-23) and `function valid` (lines 46-51). Replace the type import at the top of the file:

```ts
import { useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { useZodForm, applyServerFieldErrors } from '@/lib/form';
import { webhooksSchema, WEBHOOKS_LIMIT, type Webhook } from '@/lib/schemas.generated';
import { Field, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field';

// The form owns the list; the patch shape the route accepts is wider.
const formSchema = z.object({ webhooks: webhooksSchema });
type FormValues = z.input<typeof formSchema>;
```

Keep `interface WebhooksResponse` (lines 25-29) — it describes the GET payload, not the form.

Keep `clientMintId` and `blank` (lines 31-44). `blank` still seeds a client-side id so React keys and the "Send test" call have something stable before the first save.

- [ ] **Step 2: Replace the `hooks` state with a field array**

Inside `WebhooksPanel`, replace `const [hooks, setHooks] = useState<Webhook[] | null>(null)` with the form. Leave `events`, `trackPlayListenerGated`, `err`, and `busy` state exactly as they are.

```ts
  const form = useZodForm(formSchema, { webhooks: [] });
  // keyName defaults to 'id' — which would CLOBBER our webhook's own `id`
  // field. Renaming RHF's internal key is mandatory here, not cosmetic.
  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: 'webhooks',
    keyName: '_rhfKey',
  });
  const [loaded, setLoaded] = useState(false);
```

In the load effect (line 224), replace `setHooks(j.webhooks || [])` with:

```ts
        form.reset({ webhooks: j.webhooks || [] });
        setLoaded(true);
```

Add `form` to that effect's dependency array. Replace the loading guard at line 305 — `if (!hooks || !events)` becomes `if (!loaded || !events)`.

- [ ] **Step 3: Rework `save` to submit the form and map server errors back**

Replace the `save` function (lines 244-261):

```ts
  const save = form.handleSubmit(async (values) => {
    setBusy(true);
    try {
      const r = await adminFetch('/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhooks: values.webhooks }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        webhooks?: Webhook[];
        error?: string;
        fieldErrors?: Record<string, string>;
      };
      if (!r.ok) {
        // A rule only the server can check still lands on the right input.
        applyServerFieldErrors(form, j.fieldErrors);
        throw new Error(j.error || `failed (${r.status})`);
      }
      // Re-seed from the server response so redacted authHeaders come back as
      // the 'set' sentinel rather than the value we just sent.
      form.reset({ webhooks: j.webhooks || [] });
      notify.ok('Webhooks saved.');
    } catch (e) {
      notify.err(`Save failed: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  });
```

Leave `saveGate` (lines 266-286) and `fireTest` (lines 288-296) **completely unchanged**. `saveGate` must keep its own request and its own state — see behaviour 1 above.

- [ ] **Step 4: Rewire the header bar controls**

Replace the Add / Save buttons (lines 335-345):

```tsx
          <Btn
            sm
            onClick={() => append(blank(events))}
            disabled={fields.length >= WEBHOOKS_LIMIT}
          >Add</Btn>
          <Btn
            sm
            tone="accent"
            onClick={save}
            disabled={!form.formState.isValid || busy}
          >{busy ? 'Saving…' : 'Save'}</Btn>
```

Delete `const allValid = hooks.every(valid);` at line 313.

Replace the two counters at lines 330-333, which read the old state:

```tsx
          <span className="caption">{fields.length} hook{fields.length === 1 ? '' : 's'}</span>
          <span className="caption text-vermilion">
            {form.watch('webhooks').filter(h => h.enabled).length} enabled
          </span>
```

Also update the empty-state Add button at line 373 to `onClick={() => append(blank(events))}`.

- [ ] **Step 5: Convert the row body to `Field` primitives**

Replace the `hooks.map(...)` block (lines 378-463). The row keys on `f._rhfKey`, and each input registers by its array path.

```tsx
      {fields.map((f, i) => {
        const row = form.watch(`webhooks.${i}`);
        const rowErrors = form.formState.errors.webhooks?.[i];
        const toggleEvent = (ev: string) => {
          const has = row.events.includes(ev);
          form.setValue(
            `webhooks.${i}.events`,
            has ? row.events.filter(e => e !== ev) : [...row.events, ev],
            { shouldValidate: true, shouldDirty: true },
          );
        };
        return (
          <Card
            key={f._rhfKey}
            /* A webhook URL is one long unbreakable token and `.card-head` is a
               flex row that doesn't wrap, so break inside the title instead. */
            title={
              row.url
                ? <span className="break-all">{row.url}</span>
                : <span className="text-muted italic">(new webhook)</span>
            }
            right={
              <>
                <Pill tone={row.enabled ? 'accent' : 'default'} dot={row.enabled}>
                  {row.enabled ? 'enabled' : 'disabled'}
                </Pill>
                <Toggle
                  on={row.enabled}
                  onClick={() => form.setValue(`webhooks.${i}.enabled`, !row.enabled, { shouldDirty: true })}
                  ariaLabel="Enable webhook"
                />
              </>
            }
          >
            <div className="grid gap-3">
              <Field data-invalid={!!rowErrors?.url}>
                <FieldLabel className="caption" htmlFor={`wh-url-${f._rhfKey}`}>URL</FieldLabel>
                <Input
                  id={`wh-url-${f._rhfKey}`}
                  {...form.register(`webhooks.${i}.url`)}
                  placeholder="https://discord.com/api/webhooks/…"
                  aria-label="Webhook URL"
                  spellCheck={false}
                />
                <FieldError errors={rowErrors?.url ? [rowErrors.url] : undefined} />
              </Field>

              <Field>
                <FieldLabel className="caption" htmlFor={`wh-auth-${f._rhfKey}`}>
                  Authorization header (optional)
                </FieldLabel>
                <Input
                  id={`wh-auth-${f._rhfKey}`}
                  {...form.register(`webhooks.${i}.authHeader`)}
                  // A stored header comes back as the 'set' sentinel. Show it as
                  // blank so an untouched field re-sends 'set' and the server
                  // keeps the secret.
                  value={row.authHeader === 'set' ? '' : row.authHeader}
                  onChange={e => form.setValue(`webhooks.${i}.authHeader`, e.target.value, { shouldDirty: true })}
                  placeholder={row.authHeader === 'set' ? '(stored, leave blank to keep)' : 'Bearer …'}
                  aria-label="Authorization header"
                  spellCheck={false}
                />
                <FieldDescription className="mt-1 text-[10px]">
                  Sent verbatim as the <code>Authorization</code> header. Stored at rest in <code>settings.json</code>.
                </FieldDescription>
                <FieldError errors={rowErrors?.authHeader ? [rowErrors.authHeader] : undefined} />
              </Field>

              <Field data-invalid={!!rowErrors?.events}>
                <FieldLabel className="caption">Events</FieldLabel>
                <div className="mt-1 flex flex-wrap gap-2">
                  {events.map(ev => {
                    const on = row.events.includes(ev);
                    return (
                      <Pill
                        key={ev}
                        tone={on ? 'accent' : 'default'}
                        dot={on}
                        onClick={() => toggleEvent(ev)}
                        // These pills are the event picker, so they need a
                        // thumb-sized target on a phone.
                        className="min-h-9 cursor-pointer sm:min-h-0"
                      >
                        {ev}
                      </Pill>
                    );
                  })}
                </div>
                <FieldError errors={rowErrors?.events ? [rowErrors.events] : undefined} />
              </Field>

              <div className="mt-1 flex items-center gap-2">
                <Btn sm tone="accent" onClick={() => fireTest(row.id!)} disabled={!row.url}>
                  Send test
                </Btn>
                <span className="ml-auto" />
                <Btn sm tone="danger" onClick={() => remove(i)}>Remove</Btn>
              </div>
            </div>
          </Card>
        );
      })}
```

Note the `authHeader` input uses an explicit `value`/`onChange` pair rather than bare `register`, because the `'set'` sentinel must render as blank while remaining the stored form value.

If `replace` is now unused from the `useFieldArray` destructure, drop it — `@typescript-eslint/no-unused-vars` is an `error` in this project.

- [ ] **Step 6: Verify against a real controller**

Use the `verify` skill — an isolated controller on a spare port with a temp `STATE_DIR`, the worktree Next dev server, and Playwright against `/admin/connect?tab=webhooks`. Pre-seed `subwave_admin_auth` in `localStorage`; the sign-in form's delayed `/admin/dash` push breaks dev-mode tests otherwise.

Walk the six behaviours listed at the top of this task:
1. Flip the listener gate — confirm one `POST /webhooks` carrying only `trackPlayListenerGated`, and that an unsaved row edit is still present afterwards.
2. Type `ftp://x` in a URL — confirm the inline `FieldError` reads "URL must start with http:// or https://" and Save is disabled.
3. Add rows to 16 — confirm Add disables.
4. Save a hook with `Bearer abc`, reload, confirm the field renders blank with `(stored, leave blank to keep)`; save again without touching it and confirm via the controller's `settings.json` that the header is still `Bearer abc`.
5. Confirm "Send test" is disabled on a blank-URL row.
6. Confirm a blank row's card title reads `(new webhook)`.

- [ ] **Step 7: Lint**

Run: `cd web && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/components/admin/WebhooksPanel.tsx
git commit -m "feat(web): validate the webhooks form against the shared zod schema"
```

---

### Task 6: Document the pattern

**Files:**
- Modify: `CLAUDE.md` (root, "Working on this codebase" bullet list)
- Modify: `controller/CLAUDE.md`
- Modify: `web/CLAUDE.md`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: nothing.

This codebase documents load-bearing invariants in `CLAUDE.md` and relies on that heavily. The mirror-and-drift-check rule is exactly such an invariant — a future contributor who edits `web/lib/schemas.generated.ts` by hand will have their change silently erased by CI.

- [ ] **Step 1: Add the root `CLAUDE.md` bullet**

Add to the "Working on this codebase" list in the root `CLAUDE.md`:

```markdown
- **Shared form schemas (zod)**: a validated shape is defined ONCE in `controller/src/schemas/<feature>.ts` and mirrored into `web/lib/schemas.generated.ts` by `npm run gen:schemas`, with `lint.yml` regenerating + `git diff --exit-code`ing it — same mechanism as the theme-token mirror, and for the same reason (the web package can't import `controller/src` at build time: separate package, separate Docker build context). **Files under `src/schemas/` may import ONLY from `zod`** — enforced by a `no-restricted-imports` rule in `controller/eslint.config.mjs`, because the file is copied verbatim into the browser bundle. Rules that aren't pure functions of one value go in a `*-server.ts` sibling, which is NOT mirrored: for webhooks that's the `authHeader: 'set'` redaction sentinel (needs the existing list), id minting (a side effect), and cross-item id de-duplication (needs sibling awareness). Never hand-edit the generated mirror. `middleware/validate.ts`'s `validateBody()` runs the schema at the route boundary and returns `{ error, fieldErrors }` — `error` is the flat string every existing client already reads from a 400, `fieldErrors` is keyed by dotted path (`webhooks.1.url`), which is also react-hook-form's `setError` syntax, so a server-only rule lands on the right input. **It does NOT replace `settings.update()`'s validation** — `update()` is reached by backup import and onboarding too and stays the authoritative chokepoint, so `validate*Strict` keeps its name and signature and calls the same schema. Web forms bind via `lib/form.ts`'s `useZodForm`. There is deliberately **no `ui/form.tsx`**: shadcn's `Field` primitives are already vendored and `FieldError` already takes react-hook-form's `{ message }` shape.
```

- [ ] **Step 2: Add the `controller/CLAUDE.md` note**

Add after the `settings.js` bullet:

```markdown
- `schemas/` — shared zod schemas, the source of truth for validated request/form shapes, mirrored into `web/lib/schemas.generated.ts` (see root `CLAUDE.md`). Import-restricted to `zod` only; stateful rules live in `*-server.ts` siblings. `middleware/validate.ts` applies them at the route boundary; `settings/validate.ts`'s `validate*Strict` functions apply the same schemas at the persistence chokepoint.
```

- [ ] **Step 3: Add the `web/CLAUDE.md` note**

Add after the stream-URL paragraph:

```markdown
**Forms.** Admin forms validate against `lib/schemas.generated.ts` — the committed mirror of `controller/src/schemas/**`, regenerated by `cd controller && npm run gen:schemas` and drift-checked in CI. **Never edit the mirror by hand.** Bind with `lib/form.ts`'s `useZodForm` (react-hook-form + `zodResolver`, `mode: 'onChange'`) and render with the shadcn `Field` primitives in `components/ui/field.tsx` — `FieldError` takes react-hook-form's error shape directly. There is no `ui/form.tsx` and one should not be added. When a field array holds records with their own `id`, `useFieldArray` **must** pass `keyName: '_rhfKey'`, or react-hook-form clobbers the real id. Server-side failures come back as `{ error, fieldErrors }`; `applyServerFieldErrors` maps them onto inputs.
```

- [ ] **Step 4: Final full verification**

Run:
```bash
cd controller && npm test && npm run lint && npm run gen:schemas && git diff --exit-code ../web/lib/schemas.generated.ts
cd ../web && npm run lint
```
Expected: all PASS, no diff.

- [ ] **Step 5: Commit and open the PR**

```bash
git add CLAUDE.md controller/CLAUDE.md web/CLAUDE.md
git commit -m "docs: document the shared zod schema + form pattern"
git push -u origin worktree-zod-forms-foundation
gh pr create --base develop --draft \
  --title "feat: zod validation + shadcn form foundation (webhooks slice)" \
  --body "Implements docs/superpowers/specs/2026-08-04-zod-forms-foundation-design.md.

Foundation for schema-validated forms, proven end-to-end on Webhooks.

- \`controller/src/schemas/\` — shared zod schemas, import-restricted to zod, mirrored into \`web/lib/schemas.generated.ts\` and drift-checked in CI (same mechanism as the theme-token mirror)
- Stateful rules (authHeader redaction sentinel, id minting, cross-item dedupe) isolated in a server-only sibling so the mirror stays browser-safe
- \`middleware/validate.ts\` validates request bodies at the route boundary, returning additive \`{ error, fieldErrors }\`
- \`settings.update()\` remains the authoritative chokepoint — \`validateWebhooksStrict\` keeps its name and signature, now backed by the shared schema
- Removes the webhook shape's 3 duplicate type declarations, the duplicated \`WEBHOOK_EVENTS\` list, and the client-side \`valid()\` predicate that re-implemented only 2 of the server's 4 URL rules
- \`web\` gains zod + react-hook-form; forms bind via \`useZodForm\` and the already-vendored shadcn \`Field\` primitives (no \`ui/form.tsx\`)

Remaining ~77 forms convert incrementally against this convention — suggested order in the spec."
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: schema module and the three excluded rules → Task 1; generator, CI drift check, ESLint restriction → Task 2; `validateBody` and the additive error contract → Task 3; `settings.update()` staying the chokepoint → Task 1 Step 5; web form layer and `useZodForm` → Task 4; the `WebhooksPanel` conversion → Task 5; the testing plan → Task 1 Step 1 (items 1-6 of the spec's list) plus Task 5 Step 6 (manual verification); migration path → documented in Task 6.

**Type consistency.** `Webhook`, `WebhookParsed`, `WebhookEvent`, `WEBHOOK_EVENTS`, `WEBHOOKS_LIMIT`, `webhookSchema`, `webhooksSchema`, `webhooksPatchSchema`, `mergeWebhookSecrets`, `validateBody`, `firstMessage`, `flattenIssues`, `useZodForm`, `applyServerFieldErrors` are each defined in exactly one task and referenced by the same name thereafter. `keyName: '_rhfKey'` is used consistently in Task 5 Steps 2 and 5.

**Known risk carried forward.** Task 2 Step 5 may not be able to type-check the mirror until Task 4 installs zod in `web/`. The step states the fallback check explicitly rather than leaving it to judgement.
