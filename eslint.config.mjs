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

// A PoolContext is proof of passed guards: only the factory builds one, never a cast.
const poolContextCastMessage =
  'Never cast to PoolContext. It is created only by requirePoolAccess (packages/services) ' +
  'through @nestvault/db/pool-context-factory.';
const noPoolContextCast = {
  selector: "TSAsExpression[typeAnnotation.typeName.name='PoolContext']",
  message: poolContextCastMessage,
};
const noPoolContextAngleCast = {
  selector: "TSTypeAssertion[typeAnnotation.typeName.name='PoolContext']",
  message: poolContextCastMessage,
};

const poolContextFactoryImport = {
  group: ['@nestvault/db/pool-context-factory'],
  message:
    'Only packages/services (requirePoolAccess) and tests may create a PoolContext (architecture rule 3).',
};

// scripts, worker and tests load config through ./node; browser-reachable code must not.
const configNodeImport = {
  group: ['@nestvault/config/node'],
  message: 'Use @nestvault/config (server) or @nestvault/config/public (browser) in apps/web.',
};

// @nestvault/db no longer imports server-only (the worker and scripts use it), so keep it out of
// the web app by rule: pages reach data through packages/services.
const dbImport = {
  group: ['@nestvault/db', '@nestvault/db/*'],
  message: 'apps/web reaches the database only through packages/services.',
};

const baseRestrictions = [noSqlRaw, noProcessEnv, noPoolContextCast, noPoolContextAngleCast];

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

// Conditional JSX is `cond && <X />`, not `cond ? <X /> : null`. A ReactNode condition that can be
// 0 is written `!!value && …` so the 0 is never rendered.
const noJsxTernaryNull = {
  selector:
    "JSXExpressionContainer > ConditionalExpression[alternate.type='Literal'][alternate.raw='null']",
  message: 'Use `condition && <X />` instead of `condition ? <X /> : null` in JSX.',
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
      'no-restricted-syntax': ['error', ...baseRestrictions],
      'no-restricted-imports': ['error', { patterns: [poolContextFactoryImport] }],
    },
  },
  {
    // Migrations may need raw SQL.
    files: ['packages/db/**/migrations/**'],
    rules: {
      'no-restricted-syntax': ['error', noProcessEnv, noPoolContextCast, noPoolContextAngleCast],
    },
  },
  {
    // The config package is the only place that reads process.env.
    files: ['packages/config/**'],
    rules: {
      'no-restricted-syntax': ['error', noSqlRaw, noPoolContextCast, noPoolContextAngleCast],
    },
  },
  {
    // Test-runner configuration reads CI flags; it never runs inside the product.
    files: ['playwright.config.ts'],
    rules: {
      'no-restricted-syntax': ['error', noSqlRaw, noPoolContextCast, noPoolContextAngleCast],
    },
  },
  {
    // The factory is the one file that builds a PoolContext.
    files: ['packages/db/src/pool-context.factory.ts'],
    rules: { 'no-restricted-syntax': ['error', noSqlRaw, noProcessEnv] },
  },
  {
    // Allowed importers of the factory: the guards (services), the db package and the tests.
    files: ['packages/services/**', 'packages/db/**', 'tests/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Browser-reachable app code: no Node-only config entry.
    files: ['apps/web/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [dbImport, configNodeImport] }],
    },
  },
  {
    // User-facing components: UI text is translated, never typed into the JSX.
    files: ['apps/web/src/**/*.tsx', 'packages/ui/src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...baseRestrictions,
        noJsxText,
        noJsxTextAttribute,
        noJsxTernaryNull,
      ],
    },
  },
);
