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
//
// The output is ONE FLAT FILE — every module's top level ends up in the same
// scope. That is why buildMirror() enforces two things the source modules get
// for free: unique top-level names across all modules, and exactly one zod
// import form. Both fail HERE, at generate time, naming the source file — never
// downstream as a tsc error inside a generated file nobody is allowed to edit.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src', 'schemas');
const OUT = join(HERE, '..', '..', 'web', 'lib', 'schemas.generated.ts');

export interface SchemaModule {
  /** Bare filename, e.g. 'webhook.ts' — used in banners and error messages. */
  file: string;
  source: string;
}

// The ONE zod import form a mirrored module may use. Quote style and the
// trailing semicolon are both optional because eslint's zod-only restriction
// is not quote- or semicolon-sensitive: a module written `import { z } from
// "zod"` lints clean, so the strip has to recognise it too or its import
// survives into the mirror and redeclares `z`.
const CANONICAL_ZOD_IMPORT = /^import\s*\{\s*z\s*\}\s*from\s*["']zod["']\s*;?\s*$/;
// Any import line at all — used to spot a NON-canonical zod import.
const IMPORT_LINE = /^\s*import\b/;
const ZOD_SPECIFIER = /["']zod["']/;
// The closing line of a multi-line zod import (`} from 'zod';`), which the
// IMPORT_LINE test above would sail past — it only sees the opening `import {`,
// which names no specifier. Anchored at line start so a comment mentioning
// "from 'zod'" mid-sentence (webhook.ts's own header does) isn't caught.
const ZOD_IMPORT_TAIL = /^\s*(?:\}\s*)?from\s*["']zod["']/;

// Top-level declarations only — no leading whitespace, because anything
// indented is nested and can't collide in the flat output.
const TOP_LEVEL_DECL =
  /^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function\s*\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;

/** Every top-level binding a module introduces, exported or not. */
export function collectDeclarations(source: string): string[] {
  const names: string[] = [];
  for (const line of source.split('\n')) {
    const m = TOP_LEVEL_DECL.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

// Drops the module's own zod import. DELIBERATE CHOICE: `import * as z from
// 'zod'`, a default import, and extra named bindings (`import { z, ZodType }`)
// are REJECTED rather than rewritten. A namespace import is not the same
// binding as a named one, and silently swapping it for the mirror's
// `import { z } from 'zod'` could change what the code means; extra named
// bindings would simply vanish and break the mirror at tsc time. One form,
// enforced loudly, keeps the mirror a verbatim copy.
function stripZodImport(mod: SchemaModule): string {
  const kept: string[] = [];
  for (const line of mod.source.split('\n')) {
    if (CANONICAL_ZOD_IMPORT.test(line)) continue;
    const isZodImport =
      (IMPORT_LINE.test(line) && ZOD_SPECIFIER.test(line)) || ZOD_IMPORT_TAIL.test(line);
    if (isZodImport) {
      throw new Error(
        `gen:schemas — controller/src/schemas/${mod.file} imports zod as:\n` +
          `    ${line.trim()}\n` +
          `  The mirror is one flat file with a single \`import { z } from 'zod'\` at the top, so a\n` +
          `  mirrored module must use exactly that form (on one line). Rewrite the import and use\n` +
          `  \`z.\` accessors (z.ZodType, z.infer, …) for anything else you need from zod.`,
      );
    }
    kept.push(line);
  }
  return kept.join('\n').trim();
}

export function buildMirror(modules: SchemaModule[]): string {
  // Seeded with the one name the generated preamble itself declares, so a
  // module declaring `z` collides here rather than in the browser build.
  const seen = new Map<string, string>([['z', "the mirror's own `import { z } from 'zod'`"]]);

  const parts = modules.map((mod) => {
    const stripped = stripZodImport(mod);
    const where = `controller/src/schemas/${mod.file}`;
    for (const name of collectDeclarations(stripped)) {
      const prev = seen.get(name);
      if (prev) {
        throw new Error(
          `gen:schemas — duplicate top-level name "${name}".\n` +
            `  declared in ${where}\n` +
            `  already declared in ${prev}\n` +
            `  Every src/schemas/*.ts module is concatenated into ONE file\n` +
            `  (web/lib/schemas.generated.ts), so top-level names share a single scope —\n` +
            `  including module-private ones. Rename one of them (e.g. WEBHOOK_ID_RE).`,
        );
      }
      seen.set(name, where);
    }
    const rule = '─'.repeat(Math.max(0, 40 - mod.file.length));
    return `// ─── from controller/src/schemas/${mod.file} ${rule}\n\n${stripped}`;
  });

  return `// GENERATED FILE — do not edit by hand.
// Mirror of controller/src/schemas/*.ts. Regenerate with:
//   cd controller && npm run gen:schemas
// CI fails if this drifts from the controller schemas.
//
// These are the SAME schemas the controller enforces. The form resolver and the
// route middleware therefore cannot disagree.

import { z } from 'zod';

${parts.join('\n\n')}
`;
}

function main() {
  const files = readdirSync(SRC)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('-server.ts'))
    .sort();

  const modules = files.map((file) => ({ file, source: readFileSync(join(SRC, file), 'utf8') }));
  writeFileSync(OUT, buildMirror(modules));
  console.log(`wrote ${OUT} (${files.length} module${files.length === 1 ? '' : 's'})`);
}

// Importable by scripts/schemas.test.ts without writing the mirror.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
