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
