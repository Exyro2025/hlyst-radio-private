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
  type Resolver,
  type UseFormReturn,
} from 'react-hook-form';
import type { z } from 'zod';

export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  defaultValues: DefaultValues<z.input<S>>,
): UseFormReturn<z.input<S>> {
  return useForm<z.input<S>>({
    // zodResolver's generic inference doesn't propagate through the
    // `S extends z.ZodType<FieldValues, FieldValues>` bound (Output/Input only
    // appear inside T's constraint, not in a directly-inferable position), so
    // it comes back widened to plain FieldValues. The cast pins it back to
    // this schema's actual input shape without changing what runs at
    // runtime — zodResolver(schema) is still exactly what's called.
    resolver: zodResolver(schema) as unknown as Resolver<z.input<S>>,
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
