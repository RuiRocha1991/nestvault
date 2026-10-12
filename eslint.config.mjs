import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

const noSqlRaw = {
  selector: "CallExpression[callee.object.name='sql'][callee.property.name='raw']",
  message:
    'sql.raw() is forbidden outside packages/db migrations (SQL injection, security control 1).',
};

const noProcessEnv = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message: 'Read environment variables only through @nestvault/config (security control 15).',
};

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'docs/**',
      'design/**',
      'services/parser/**',
      'tests/lint/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
    rules: {
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-duplicates': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': ['error', noSqlRaw, noProcessEnv],
    },
  },
  {
    // Migrations may need raw SQL.
    files: ['packages/db/**/migrations/**'],
    rules: { 'no-restricted-syntax': ['error', noProcessEnv] },
  },
  {
    // The config package is the only place that reads process.env.
    files: ['packages/config/**'],
    rules: { 'no-restricted-syntax': ['error', noSqlRaw] },
  },
);
