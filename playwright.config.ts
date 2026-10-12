import { defineConfig } from '@playwright/test';

// Browser checks run against the production build (the same CSP as a real deployment).
// Port 4010 keeps them apart from `pnpm dev` (4000) and the header integration test uses the same one,
// so run them one after the other.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:4010' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command:
      'pnpm --filter @nestvault/web build && pnpm --filter @nestvault/web exec next start -p 4010',
    url: 'http://127.0.0.1:4010/demo',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
