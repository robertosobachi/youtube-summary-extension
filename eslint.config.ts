import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-plugin-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],

    plugins: {
      prettier,
      import: importPlugin,
    },

    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettierConfig],

    languageOptions: {
      globals: globals.node,
    },

    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          'newlines-between': 'never',
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],

    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**', 'fixtures/**'],
  },
]);
