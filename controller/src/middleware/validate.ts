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
