import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  ...tseslint.configs.recommended,
  globalIgnores(['node_modules/**', 'scripts/**']),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Files under src/schemas/ are mirrored verbatim into the web bundle by
    // scripts/gen-schemas.ts, so they must not reach for anything the browser
    // cannot resolve. *-server.ts is the escape hatch and is NOT mirrored.
    files: ['src/schemas/*.ts'],
    ignores: ['src/schemas/*-server.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // This ESLint version's no-restricted-imports schema has no
              // top-level "allow" (see task-2-report.md) — "group" is matched
              // gitignore-style via the `ignore` package, so a leading "!zod"
              // negates the wildcard restriction for that one import.
              group: ['*', '!zod'],
              message:
                'src/schemas/* is mirrored into the browser — import only from "zod". Put anything else in a *-server.ts sibling.',
            },
          ],
        },
      ],
    },
  },
]);
