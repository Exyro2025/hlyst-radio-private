// Turning a ZodError into something an operator can read.
//
// A raw ZodError's `.message` is a pretty-printed JSON array of issue objects —
// ~15 lines for one bad URL. Every route that surfaces a failure does
// `res.status(400).json({ error: err.message })`, so that blob lands verbatim
// in a toast. These two helpers are the one place that translation lives.
//
// Neutral on purpose: BOTH middleware/validate.ts (route boundary) and
// settings/validate.ts (the persistence chokepoint update() reaches from backup
// restore and PUT /settings) import from here. Importing middleware/ into
// settings/ would invert the dependency direction, so neither owns it.
import type { ZodError } from 'zod';

// Dotted path — 'webhooks.1.url' — which is also react-hook-form's setError
// field syntax, so the admin form can map these straight onto inputs.
function pathOf(issue: ZodError['issues'][number]): string {
  return issue.path.join('.');
}

/**
 * One message per field, keyed by dotted path.
 *
 * The accumulator is a NULL-PROTOTYPE object, and that is load-bearing: field
 * names come from user data. On a plain `{}` literal, a field named `toString`
 * would be swallowed by the first-wins guard (`'toString' in {}` is true via
 * the prototype chain), and a field named `__proto__` would be dropped no
 * matter what the guard said, because `out['__proto__'] = msg` on a literal
 * attempts a prototype set instead of creating an own property. Object.create(null)
 * closes both at once — swapping `in` for Object.hasOwn would only close the first.
 */
export function flattenIssues(error: ZodError): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const issue of error.issues) {
    const key = pathOf(issue);
    // First error per field wins — a field with three problems should surface
    // one message, not a stack of them.
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** A flat, single-line message — what a 400's `error` string carries. */
export function firstMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid request body';
  const key = pathOf(issue);
  // Zod's built-in type messages ("expected array, received string") don't name
  // the field, so prefix the path when the message doesn't stand on its own.
  const standalone = issue.code !== 'invalid_type';
  return standalone || !key ? issue.message : `${key}: ${issue.message}`;
}
