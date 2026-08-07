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
 * Same validation, LISTENER-facing error shape. For public forms only — today
 * that is POST /request and nothing else.
 *
 * Two differences from validateBody, both because the reader is a listener
 * looking at a request box in a player skin rather than an operator looking at
 * an admin form:
 *
 *  - **No dotted-path prefix.** `firstMessage` prefixes unconditionally, which
 *    is right when the operator has to find `webhooks.1.url` among nine rows,
 *    and wrong when the string is rendered on its own: "text: Keep it under 280
 *    characters." reads as a bug to a listener. The schema's messages are
 *    already written to stand alone.
 *  - **`success: false` and `message` ride along.** The web player runs the
 *    mirrored schema as a pre-flight and never meets this 400 at all, but the
 *    native app posts /request directly and reads `data.message` on a failure.
 *    It ships through the app stores, so it cannot be updated in lockstep with
 *    the controller — an already-installed build meeting a new refusal has to
 *    have something to render, or the drawer shows an empty failure card.
 */
export function validatePublicBody(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = schema.safeParse(req.body);
    if (!r.success) {
      const message = r.error.issues[0]?.message || 'invalid request body';
      return res.status(400).json({
        success: false,
        error: message,
        message,
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
