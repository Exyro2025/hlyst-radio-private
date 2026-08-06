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
//
// The ZodError → readable-string translation lives in util/zod-error.ts, shared
// with settings/validate.ts — settings/ must not import middleware/.
import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { firstMessage, flattenIssues } from '../util/zod-error.js';

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

/**
 * Same contract, for a schema that cannot exist until the request does.
 *
 * A show is the first shape that can't be validated against itself — its host
 * has to name a real persona, its moods a live mood, its theme an installed
 * one — so its schema is a FACTORY over a context read from live settings.
 * Rather than let that route hand-roll its own 400, it hands over a resolver
 * and the error payload stays shaped in exactly one place.
 *
 * A resolver that throws yields a 500, not a 400: failing to READ the context
 * is a server fault, and reporting it as a validation error would tell the
 * operator their input was bad when it never got looked at.
 */
export function validateBodyAsync(resolve: (req: Request) => Promise<ZodType> | ZodType) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let schema: ZodType;
    try {
      schema = await resolve(req);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
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
