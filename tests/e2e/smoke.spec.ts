import { expect, test } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { STORAGE_STATE } from './support/user';

// Texts come from the message catalogue, so a copy edit does not break these tests.
// The document title is a literal in apps/web/src/app/layout.tsx, not a message.
const TITLE = 'Cofre Familiar';
const NAV = messages.nav.label;

// These pages need a session: they run as the E2E owner created in global-setup.ts.
test.use({ storageState: STORAGE_STATE });

// Smoke test: the shell loads. A failure here means the app does not start or render at all.
test('the shell loads: redirect, title, main navigation and page heading', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page).toHaveTitle(TITLE);
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-PT');
  await expect(page.getByRole('navigation', { name: NAV })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: messages.nav.items.overview }),
  ).toBeVisible();
});

test('a sidebar link opens another section', async ({ page }) => {
  const accounts = messages.nav.items.accounts;
  await page.goto('/demo');
  await page.getByRole('navigation', { name: NAV }).getByRole('link', { name: accounts }).click();
  await expect(page).toHaveURL(/\/demo\/contas$/);
  await expect(page.getByRole('heading', { level: 1, name: accounts })).toBeVisible();
});

test('the chosen theme is stored in the nv-theme cookie and rendered by the server on reload', async ({
  context,
  page,
}) => {
  // Start from a known state: no cookie means the default theme (dark).
  await context.clearCookies({ name: 'nv-theme' }); // keep the session cookie
  await page.goto('/demo');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('switch', { name: messages.theme.switchLabel }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === 'nv-theme')?.value).toBe('light');

  // The server renders the theme from the cookie: check the raw HTML, before any script runs.
  const raw = await page.request.get('/demo');
  expect(await raw.text()).toMatch(/<html[^>]*data-theme="light"/);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
});
