import { existsSync } from 'node:fs';

import { chromium, defineConfig } from '@playwright/test';

import { loadLocalEnv } from './tests/db/load-env';
import { E2E_ORIGIN, E2E_OPEN_SIGNUP_ORIGIN } from './tests/e2e/support/user';

// The server reads the `_test` databases (never the development ones) and is told the origin the
// browser uses, because the Origin check on writes compares against APP_URL.
loadLocalEnv();
const ORIGIN = E2E_ORIGIN;

// One server per sign-up mode, on the same build and the same `_test` databases. Each one's APP_URL
// is its own origin because the Origin check on writes compares against it. The first one builds
// the app; Playwright starts them one after the other, so the build exists for the next ones.
const port = (origin: string) => Number(new URL(origin).port);
const SIGNUP_SPEC = 'signup';
// The sign-up server is only needed by signup.spec.ts. When the run names other spec files
// (`pnpm test:e2e login`), it is not started. E2E_SIGNUP_SERVER=1|0 forces it on or off.
const filters = process.argv
  .slice(2)
  .filter((arg, i, all) => !arg.startsWith('-') && all[0] === 'test' && i > 0);
const needsSignupServer =
  process.env.E2E_SIGNUP_SERVER !== undefined
    ? process.env.E2E_SIGNUP_SERVER === '1'
    : filters.length === 0 || filters.some((filter) => filter.includes(SIGNUP_SPEC));
const servers = [
  { port: port(E2E_ORIGIN), allowSignup: 'false', build: true },
  ...(needsSignupServer
    ? [{ port: port(E2E_OPEN_SIGNUP_ORIGIN), allowSignup: 'true', build: false }]
    : []),
];

const serverEnv = (origin: string, allowSignup: string) => ({
  ...(process.env as Record<string, string>),
  APP_URL: origin,
  ALLOW_SIGNUP: allowSignup,
  ENABLE_API_DOCS: 'false',
  DATABASE_URL_IDENTITY: process.env.TEST_DATABASE_URL_IDENTITY ?? '',
  DATABASE_URL_APP: process.env.TEST_DATABASE_URL_APP ?? '',
});

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
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // `reports/` is outside `test-results/`, which Playwright empties at the start of every run.
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['junit', { outputFile: 'reports/junit-e2e.xml' }]]
    : 'list',
  use: { baseURL: ORIGIN, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: servers.map(({ port, allowSignup, build }) => ({
    command: `${build ? 'pnpm --filter @nestvault/web build && ' : ''}pnpm --filter @nestvault/web exec next start -p ${String(port)}`,
    url: `http://127.0.0.1:${String(port)}/login`,
    env: serverEnv(`http://127.0.0.1:${String(port)}`, allowSignup),
    reuseExistingServer: !process.env.CI,
    timeout: build ? 240_000 : 120_000,
  })),
});
