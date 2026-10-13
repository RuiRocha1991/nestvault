import { existsSync } from 'node:fs';

import { chromium, defineConfig } from '@playwright/test';

// A machine with browsers installed system-wide (for example /opt/pw-browsers) uses them, but only
// when they hold the Chromium revision this Playwright expects; otherwise (or when the variable is
// already set) the default cache from `pnpm exec playwright install chromium` is used.
const SYSTEM_BROWSERS = '/opt/pw-browsers';
if (existsSync(SYSTEM_BROWSERS) && process.env.PLAYWRIGHT_BROWSERS_PATH === undefined) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = SYSTEM_BROWSERS;
  if (!existsSync(chromium.executablePath())) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
}

// Browser checks run against the production build (the same CSP as a real deployment).
// Port 4010 keeps them apart from `pnpm dev` (4000); the header integration test uses it too,
// so do not run both at the same time (CI runs them in separate jobs).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4010', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command:
      'pnpm --filter @nestvault/web build && pnpm --filter @nestvault/web exec next start -p 4010',
    url: 'http://127.0.0.1:4010/demo',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
