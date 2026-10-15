import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { signInAsOwner } from './support/sign-in';
import { E2E_ORIGIN, STORAGE_STATE, loginNextUrl, poolPath, poolUrl } from './support/user';

const EXPENSES = poolPath('/despesas');

/** The sign-in screen with the expiry toast; `reason` is then removed, so a reload is quiet. */
async function expectExpiredLogin(page: Page) {
  await expect(page.getByText(messages.auth.sessionExpired).first()).toBeVisible();
  await expect(page).toHaveURL(loginNextUrl('/despesas'));
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: messages.auth.login.title }),
  ).toBeVisible();
  await expect(page.getByText(messages.auth.sessionExpired)).toHaveCount(0);
}
const expensesHeading = (page: Page) =>
  page.getByRole('heading', { level: 1, name: messages.nav.items.expenses });

test.describe('with a valid session', () => {
  test.use({ storageState: STORAGE_STATE });

  test('a refresh keeps the page and never renders the login screen', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'document') requested.push(new URL(request.url()).pathname);
    });

    await page.goto(EXPENSES);
    await expect(expensesHeading(page)).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${EXPENSES}$`));
    await expect(expensesHeading(page)).toBeVisible();
    await expect(page.getByRole('navigation', { name: messages.nav.label })).toBeVisible();
    // Every document request (including redirects) stayed on the app page: no login flash.
    expect(requested).toEqual([EXPENSES, EXPENSES]);
  });

  test('a new tab of the same browser is signed in', async ({ context, page }) => {
    await page.goto(poolPath());
    const tab = await context.newPage();
    await tab.goto(EXPENSES);
    await expect(tab).toHaveURL(new RegExp(`${EXPENSES}$`));
    await expect(expensesHeading(tab)).toBeVisible();
  });

  test('a restarted browser (a new context with the stored cookies) is signed in', async ({
    browser,
    context,
  }) => {
    const restarted = await browser.newContext({ storageState: await context.storageState() });
    const page = await restarted.newPage();
    await page.goto(EXPENSES);
    await expect(page).toHaveURL(new RegExp(`${EXPENSES}$`));
    await expect(expensesHeading(page)).toBeVisible();
    await restarted.close();
  });

  test('the session cookie is persistent (Max-Age of 30 days), HttpOnly and SameSite=Lax', async ({
    context,
  }) => {
    const cookie = (await context.cookies()).find((c) => c.name.endsWith('nv.session_token'));
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    const days = ((cookie?.expires ?? 0) - Date.now() / 1000) / 86_400;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);
  });
});

test.describe('when the session ended', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a revoked session goes to the login screen with the expiry message', async ({
    browser,
    page,
  }) => {
    await signInAsOwner(page);
    await expect(page).toHaveURL(poolUrl());
    // The same cookies in another browser; signing out here revokes that session for both.
    const other = await browser.newContext({ storageState: await page.context().storageState() });
    const otherPage = await other.newPage();
    await otherPage.goto(EXPENSES);
    await expect(expensesHeading(otherPage)).toBeVisible();

    await page.getByRole('button', { name: messages.shell.signOut }).click();
    await expect(page).toHaveURL(/\/login$/);

    await otherPage.goto(EXPENSES);
    await expectExpiredLogin(otherPage);
    await other.close();
  });

  test('signing out in one tab sends the other tab of the browser to the login screen at once', async ({
    context,
    page,
  }) => {
    await signInAsOwner(page);
    await expect(page).toHaveURL(poolUrl());
    const otherTab = await context.newPage();
    await otherTab.goto(EXPENSES);
    await expect(expensesHeading(otherTab)).toBeVisible();

    await page.getByRole('button', { name: messages.shell.signOut }).click();
    await expect(page).toHaveURL(/\/login$/);

    await expectExpiredLogin(otherTab);
  });

  test('a tab that is shown again after its session was ended elsewhere leaves the app', async ({
    context,
    page,
  }) => {
    await signInAsOwner(page);
    await expect(page).toHaveURL(poolUrl());
    await page.goto(EXPENSES);
    await expect(expensesHeading(page)).toBeVisible();

    // Ended without this tab being told (another device, an admin): only the cookie jar changes.
    const ended = await context.request.post('/api/v1/auth/sign-out', {
      headers: { Origin: E2E_ORIGIN },
      data: {},
    });
    expect(ended.ok()).toBe(true);
    await expect(expensesHeading(page)).toBeVisible(); // nothing noticed yet

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expectExpiredLogin(page);
  });

  test('a cookie the server does not know (forged or left over) also gets the expiry message', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext();
    await context.addCookies([
      { name: 'nv.session_token', value: 'not-a-real-token.signature', url: baseURL ?? E2E_ORIGIN },
    ]);
    const page = await context.newPage();
    await page.goto(EXPENSES);
    await expectExpiredLogin(page);
    await context.close();
  });

  test('the check asks for disableRefresh and ignores a rate-limited answer', async ({ page }) => {
    await signInAsOwner(page);
    await expect(page).toHaveURL(poolUrl()); // signed in before leaving the page
    await page.goto(EXPENSES);
    await expect(expensesHeading(page)).toBeVisible();

    const asked = page.waitForRequest((request) =>
      request.url().includes('/api/v1/auth/get-session'),
    );
    await page.route('**/api/v1/auth/get-session*', (route) =>
      route.fulfill({ status: 429, headers: { 'Retry-After': '30' }, body: '{}' }),
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect((await asked).url()).toContain('disableRefresh=true');
    await page.waitForTimeout(500);
    await expect(expensesHeading(page)).toBeVisible(); // 429 says nothing about the session

    await page.unroute('**/api/v1/auth/get-session*');
    await page.route('**/api/v1/auth/get-session*', (route) =>
      route.fulfill({ status: 401, body: '{}' }),
    );
    // The real session is still valid, so the login page bounces back into the app; what matters is
    // that a 401 made the tab go there.
    const left = page.waitForRequest((request) =>
      request
        .url()
        .includes(`/login?next=${encodeURIComponent(poolPath('/despesas'))}&reason=expired`),
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await left;
  });

  test('a visitor who never signed in sees no expiry message', async ({ page }) => {
    await page.goto(EXPENSES);
    await expect(page).toHaveURL(loginNextUrl('/despesas'));
    await expect(page.getByText(messages.auth.sessionExpired)).toHaveCount(0);
  });
});
