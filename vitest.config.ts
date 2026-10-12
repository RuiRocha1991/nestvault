import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// One Vitest project per folder under tests/, named after the package it covers.
const projects = ['web', 'worker', 'domain', 'services', 'db', 'ui', 'config', 'lint'];

export default defineConfig({
  test: {
    projects: projects.map((name) => ({
      test: { name, include: [`tests/${name}/**/*.test.{ts,tsx}`] },
      // `server-only` throws outside a React Server build; the config tests stub it.
      ...(name === 'config'
        ? {
            resolve: {
              alias: {
                'server-only': fileURLToPath(
                  new URL('./tests/config/stubs/server-only.ts', import.meta.url),
                ),
              },
            },
          }
        : {}),
    })),
  },
});
