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
