import { defineConfig } from 'vitest/config';

// One Vitest project per folder under tests/, named after the package it covers.
const projects = ['web', 'worker', 'domain', 'services', 'db', 'ui', 'config', 'lint'];

export default defineConfig({
  test: {
    projects: projects.map((name) => ({
      test: { name, include: [`tests/${name}/**/*.test.{ts,tsx}`] },
    })),
  },
});
