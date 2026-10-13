import { expect, test } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { alertWith, fillAndSubmit, signInAsOwner } from './support/sign-in';
import { E2E_ORIGIN, E2E_USER } from './support/user';

const login = messages.auth.login;
const NAV = messages.nav.label;

// Every spec here starts signed out (no stored session).
test.use({ storageState: { cookies: [], origins: [] } });

test('sign in → see the app → sign out → back at the login screen', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\?next=%2Fpools$/);
  await expect(page.getByRole('heading', { level: 1, name: login.title })).toBeVisible();

  await fillAndSubmit(page, E2E_USER.email, E2E_USER.password);
  await expect(page).toHaveURL(/\/demo$/); // /pools hands over to the development pool for now
  await expect(page.getByRole('navigation', { name: NAV })).toBeVisible();

  await page.getByRole('button', { name: messages.shell.signOut }).click();
  await expect(page).toHaveURL(/\/login$/);

  // The cookie is gone and the old session is dead: the app asks for the login again.
  await page.goto('/demo');
  await expect(page).toHaveURL(/\/login\?next=%2Fdemo$/);
});

test('the revoked session cookie no longer works', async ({ page, context, request }) => {
  await signInAsOwner(page);
  await expect(page).toHaveURL(/\/demo$/);
  const cookies = await context.cookies();
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  const before = await request.get('/api/v1/auth/get-session', { headers: { cookie } });
  expect(await before.json()).not.toBeNull();

  await page.getByRole('button', { name: messages.shell.signOut }).click();
  await expect(page).toHaveURL(/\/login$/);

  const after = await request.get('/api/v1/auth/get-session', { headers: { cookie } });
  expect(await after.json()).toBeNull();
});

test('an unauthenticated page request goes to /login with the page as next, and sign-in returns to it', async ({
  page,
}) => {
  await page.goto('/demo/despesas');
  await expect(page).toHaveURL(/\/login\?next=%2Fdemo%2Fdespesas$/);
  await fillAndSubmit(page, E2E_USER.email, E2E_USER.password);
  await expect(page).toHaveURL(/\/demo\/despesas$/);
});

test('wrong password and unknown email show the same message', async ({ page }) => {
  await page.goto('/login');
  const attempt = async (email: string) => {
    const [response] = await Promise.all([
      page.waitForResponse('**/api/v1/auth/sign-in/email'),
      fillAndSubmit(page, email, 'definitely-not-the-password'),
    ]);
    const alert = alertWith(page, login.invalidTitle);
    await expect(alert).toBeVisible();
    return { status: response.status(), text: await alert.innerText() };
  };

  const wrongPassword = await attempt(E2E_USER.email);
  const unknownEmail = await attempt('nobody@e2e.example.test');
  expect(wrongPassword.status).toBe(401);
  expect(unknownEmail).toEqual(wrongPassword);
  expect(wrongPassword.text).toContain(login.invalidText);
  await expect(page.getByLabel(login.email)).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/login$/);
});

for (const next of [
  'https://evil.com',
  '//evil.com',
  '/\\evil.com',
  '/..//evil.com',
  '/.//evil.com',
]) {
  test(`next=${next} is ignored after sign-in`, async ({ page }) => {
    await signInAsOwner(page, `/login?next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(/\/demo$/);
    expect(new URL(page.url()).hostname).toBe('127.0.0.1');
  });
}

test('someone who is already signed in is sent into the app from /login', async ({ page }) => {
  await signInAsOwner(page);
  await expect(page).toHaveURL(/\/demo$/);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/demo$/);
  await page.goto('/login?next=%2Fdemo%2Fcontas');
  await expect(page).toHaveURL(/\/demo\/contas$/);
});

test('the password can be shown and hidden', async ({ page }) => {
  await page.goto('/login');
  const password = page.getByLabel(login.password, { exact: true });
  await password.fill('secret');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: login.showPassword }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: login.hidePassword }).click();
  await expect(password).toHaveAttribute('type', 'password');
});

test('sign-up is closed: the footer explains invites and offers no sign-up link', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(page.getByText(login.footClosed)).toBeVisible();
  await expect(page.getByRole('link', { name: login.createAccount })).toHaveCount(0);
  await expect(page.getByText(login.sessionNote)).toBeVisible();
});

test('a rate-limited sign-in shows the countdown and disables the button', async ({ page }) => {
  await page.route('**/api/v1/auth/sign-in/email', (route) =>
    route.fulfill({
      status: 429,
      headers: { 'Retry-After': '872', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { code: 'rate_limited', message: 'Too many requests.' } }),
    }),
  );
  await page.goto('/login');
  await fillAndSubmit(page, E2E_USER.email, 'whatever-password');
  await expect(alertWith(page, login.lockedTitle)).toContainText('14:3');
  const button = page.getByRole('button', { name: /^Tenta novamente em 14:/ });
  await expect(button).toBeDisabled();
});

test.describe('layout', () => {
  test('desktop shows the brand panel; mobile hides it and keeps the logo', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    await expect(
      page.getByRole('heading', { level: 2, name: messages.auth.brand.headline }),
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole('heading', { level: 2, name: messages.auth.brand.headline }),
    ).toBeHidden();
    await expect(page.getByText(messages.brand.name).last()).toBeVisible();
    const card = page.getByRole('heading', { level: 1, name: login.title });
    await expect(card).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test('the light theme renders the screen', async ({ page, context }) => {
    await context.addCookies([{ name: 'nv-theme', value: 'light', url: E2E_ORIGIN }]);
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('heading', { level: 1, name: login.title })).toBeVisible();
  });
});
