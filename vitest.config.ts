import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// One Vitest project per folder under tests/, named after the package it covers.
const projects = ['web', 'worker', 'domain', 'services', 'db', 'ui', 'config', 'lint'];

// `server-only` throws outside a React Server build, so tests replace it with an empty module.
const serverOnlyStub = fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url));

const webSrc = fileURLToPath(new URL('./apps/web/src/', import.meta.url));

export default defineConfig({
  test: {
    projects: projects.map((name) => ({
      test: {
        name,
        include: [`tests/${name}/**/*.test.{ts,tsx}`],
        // The db tests share one Postgres: migrate and reset once per run, then run files in turn.
        ...(name === 'db'
          ? {
              globalSetup: ['tests/db/global-setup.ts'],
              setupFiles: ['tests/db/setup-env.ts'],
              fileParallelism: false,
            }
          : {}),
      },
      resolve: {
        alias: [
          { find: 'server-only', replacement: serverOnlyStub },
          // `@webapp/…` is the web app's source alias (apps/web/tsconfig.json).
          { find: /^@webapp\//, replacement: webSrc },
        ],
      },
    })),
  },
});
