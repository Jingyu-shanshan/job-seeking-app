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
    files: ['**/*.ts', '**/*.js'],
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
