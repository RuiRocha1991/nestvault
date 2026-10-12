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

// All visible text goes through next-intl (messages/pt-PT.json): no literal strings in JSX.
const noJsxText = {
  selector: 'JSXText[value=/\\S/]',
  message: 'Hard-coded text in JSX. Use a next-intl message (apps/web/messages/pt-PT.json).',
};

const noJsxTextAttribute = {
  selector:
    'JSXAttribute[name.name=/^(title|alt|placeholder|aria-label|aria-description)$/] > Literal',
  message: 'Hard-coded text in a JSX attribute. Use a next-intl message.',
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
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.mjs', 'apps/*/*.mjs', 'scripts/*.mjs'] },
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
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
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
  {
    // User-facing components: UI text is translated, never typed into the JSX.
    files: ['apps/web/src/**/*.tsx', 'packages/ui/src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', noSqlRaw, noProcessEnv, noJsxText, noJsxTextAttribute],
    },
  },
);
