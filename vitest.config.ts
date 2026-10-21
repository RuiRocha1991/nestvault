import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Unit tests: one Vitest project per folder under tests/, named after the package it covers.
// They need nothing running. Files named `*.integration.test.ts` belong to the `integration`
// project instead: they need the Docker Postgres (tests/db) or a production build (headers).
const unitProjects = ['web', 'worker', 'domain', 'services', 'db', 'ui', 'config', 'lint'];

// `server-only` throws outside a React Server build, so tests replace it with an empty module.
const serverOnlyStub = fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url));

const webSrc = fileURLToPath(new URL('./apps/web/src/', import.meta.url));

const resolve = {
  alias: [
    { find: 'server-only', replacement: serverOnlyStub },
    // `@webapp/…` is the web app's source alias (apps/web/tsconfig.json).
    { find: /^@webapp\//, replacement: webSrc },
  ],
};

// Timing tests (the overview benchmark) skip themselves when coverage instrumentation is on: it
// slows hot loops down by 2x or more. The test workers inherit this variable.
if (process.argv.includes('--coverage')) process.env.NV_COVERAGE = '1';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
      // React pages/components are exercised by Playwright, not by v8 coverage of the unit run.
      exclude: ['**/*.d.ts', 'apps/web/src/**/*.tsx', 'packages/db/src/migrate-cli.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      // Enforced on a full `pnpm test:coverage` run (a run of one project would not reach them).
      thresholds: {
        'packages/domain/src/**': { lines: 90 },
        'packages/services/src/**': { lines: 80 },
      },
    },
    projects: [
      ...unitProjects.map((name) => ({
        test: {
          name,
          include: [`tests/${name}/**/*.test.{ts,tsx}`],
          exclude: ['**/node_modules/**', '**/*.integration.test.{ts,tsx}'],
        },
        resolve,
        // apps/web keeps `jsx: preserve` for Next; the tests compile the components themselves.
        oxc: { jsx: { runtime: 'automatic' as const } },
      })),
      {
        test: {
          name: 'integration',
          include: ['tests/**/*.integration.test.{ts,tsx}'],
          // The tests share one Postgres: migrate and reset once per run, then run files in turn.
          globalSetup: ['tests/db/global-setup.ts'],
          setupFiles: ['tests/db/setup-env.ts'],
          fileParallelism: false,
        },
        resolve,
      },
    ],
  },
});
