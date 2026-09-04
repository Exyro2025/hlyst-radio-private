// Shared between the show-boundary VM trigger (engine-tick/route.ts) and the
// ordinary-transition trigger (vm-imaging/maybe-fire/route.ts) — both read
// last_used_at off the SAME vm_imaging table and must respect the SAME
// global cooldown, or one path could fire the instant the other's cooldown
// clears, defeating the point of "minimum spacing" being a single rule.
export const VM_MIN_GAP_MINUTES = 20;

// How many of the most-recently-used assets to exclude from selection, on
// top of the cooldown — the cooldown alone only prevents firing too SOON;
// this prevents the same handful of assets cycling repeatedly once cooldown
// has cleared several times in a row. Recent-use suppression, not semantic
// (no embeddings infra for this table) — the pragmatic equivalent given
// what's actually available.
export const VM_RECENT_EXCLUDE_COUNT = 5;
