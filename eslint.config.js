import eslint from '@eslint/js';
import angular from 'angular-eslint';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    // personal, git-ignored folders are not project code
    ignores: ['**/dist/', '**/.angular/', 'coverage/', 'vault/', 'scratch/', 'artifacts/'],
  },
  {
    files: ['**/*.ts', '**/*.cts', '**/*.js'],
    extends: [eslint.configs.recommended, tseslint.configs.recommended],
  },
  {
    files: ['apps/web/**/*.ts'],
    extends: [angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      // A value import from @jsa/shared pulls its TypeBox schemas into the browser bundle, and with
      // verbatimModuleSyntax so does `import { type X }` (it stays as `import '@jsa/shared'`).
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@jsa/shared',
              allowTypeImports: true,
              message:
                'apps/web imports only types from @jsa/shared (import type { ... }); plain values come from @jsa/shared/limits.',
            },
          ],
        },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },
  {
    files: ['apps/web/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
  },
  {
    // The rules (hard-requirement evaluation, claim checks, status transitions, approval checks)
    // must stay testable without a server or a database.
    files: ['apps/server/src/rules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['fastify', '@fastify/*', 'pg', 'pg-*'],
              message: 'apps/server/src/rules must not import Fastify or pg.',
            },
          ],
        },
      ],
    },
  },
);
