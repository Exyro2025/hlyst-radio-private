// Pins settings.requests (raid hardening, 2026-07-28): defaults when absent,
// clamped when patched, byte-tolerant of pre-upgrade settings.json files.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-reqlimits-'));
const settings = await import('../src/settings.js');
await settings.load();

// Absent key → full defaults.
const d = settings.get().requests;
assert.deepEqual(d, {
  enabled: true, maxPending: 6, globalHourlyCap: 30, repeatCooldownMin: 120,
  cooldownSec: 60, perIpHourlyCap: 8, onePendingPerIp: true,
});

// Patch applies + clamps.
await settings.update({ requests: { enabled: false, maxPending: 999, cooldownSec: 1, repeatCooldownMin: -5 } });
const p = settings.get().requests;
assert.equal(p.enabled, false);
assert.equal(p.maxPending, 50);        // clamped to max
assert.equal(p.cooldownSec, 5);        // clamped to min
assert.equal(p.repeatCooldownMin, 0);  // clamped to min (0 = off)
assert.equal(p.perIpHourlyCap, 8);     // untouched fields keep current values
assert.equal(p.onePendingPerIp, true);

// Junk types fall back to current values, never NaN/undefined.
await settings.update({ requests: { maxPending: 'lots', enabled: 'yes' } });
const j = settings.get().requests;
assert.equal(j.maxPending, 50);
assert.equal(j.enabled, false);

// --- rate limiting is settings-driven ---------------------------------------
const { checkRateLimit, checkGlobalRateLimit } = await import('../src/middleware/ratelimit.js');

await settings.update({ requests: { enabled: true, cooldownSec: 5, perIpHourlyCap: 2, globalHourlyCap: 5 } });
assert.equal(checkRateLimit('10.0.0.1').ok, true);
assert.equal(checkRateLimit('10.0.0.1').ok, false); // inside 5s cooldown

// Global bucket: 5 allowed across ANY ips, 6th refused with a retryAfter.
for (let i = 0; i < 5; i++) assert.equal(checkGlobalRateLimit().ok, true);
const g = checkGlobalRateLimit();
assert.equal(g.ok, false);
assert.ok(g.retryAfter > 0);

console.log('request-limits.test.ts: all assertions passed');
