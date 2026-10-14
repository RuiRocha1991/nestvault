import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { clearMailbox, createUser, linkPath, waitForEmail } from './support/mailpit';
import { alertWith, fillAndSubmit } from './support/sign-in';
import { E2E_OPEN_SIGNUP_ORIGIN, E2E_ORIGIN } from './support/user';

const signup = messages.auth.signup;
const login = messages.auth.login;
const verify = messages.auth.verify;
const PASSWORD = 'signup-passphrase-for-e2e-only';

test.use({ storageState: { cookies: [], origins: [] } });

const unique = (prefix: string) => `${prefix}-${String(Date.now())}@e2e.example.test`;

async function fillForm(
  page: Page,
  input: { name: string; email: string; password: string; confirm?: string },
) {
  await page.getByLabel(signup.name).fill(input.name);
  await page.getByLabel(signup.email).fill(input.email);
  await page.getByLabel(signup.password, { exact: true }).fill(input.password);
  await page.getByLabel(signup.confirmPassword).fill(input.confirm ?? input.password);
}

test.describe('sign-up closed (ALLOW_SIGNUP=false)', () => {
  test('explains that people join by invite, and the API answers 403 signup_closed', async ({
    page,
    request,
  }) => {
    await page.goto('/registar');
    await expect(page.getByRole('heading', { name: signup.closedTitle })).toBeVisible();
    await expect(page.getByText(signup.closedNote)).toBeVisible();
    await expect(page.getByLabel(signup.email)).toHaveCount(0);
    await page.getByRole('link', { name: signup.closedBack }).click();
    await expect(page).toHaveURL(/\/login$/);

    const response = await request.post('/api/v1/auth/sign-up/email', {
      headers: { Origin: E2E_ORIGIN },
      data: { name: 'Ana', email: unique('closed'), password: PASSWORD },
    });
    expect(response.status()).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('signup_closed');
  });
});

test.describe('sign-up open (ALLOW_SIGNUP=true)', () => {
  test.use({ baseURL: E2E_OPEN_SIGNUP_ORIGIN });

  test('registers, cannot sign in until the email is confirmed, then can', async ({ page }) => {
    const email = unique('signup');
    await clearMailbox(email);

    // 50: from the sign-in screen
    await page.goto('/login');
    await page.getByRole('link', { name: login.createAccount }).click();
    await expect(page).toHaveURL(/\/registar$/);

    const submit = page.getByRole('button', { name: signup.submit, exact: true });
    await expect(submit).toBeDisabled();
    await fillForm(page, { name: 'Ana Rocha', email, password: 'short' });
    await expect(submit).toBeDisabled();
    await page.getByLabel(signup.password, { exact: true }).fill('palavra-passe');
    await expect(page.getByText(signup.rules.common)).toBeVisible();
    await expect(submit).toBeDisabled();
    await page.getByLabel(signup.password, { exact: true }).fill(PASSWORD);
    await page.getByLabel(signup.confirmPassword).fill(`${PASSWORD}x`);
    await expect(page.getByText(signup.mismatch)).toBeVisible();
    await expect(submit).toBeDisabled();
    await page.getByLabel(signup.confirmPassword).fill(PASSWORD);
    await expect(page.getByRole('meter')).toHaveAttribute('aria-valuenow', /[34]/);
    await submit.click();

    // 56: confirm your email
    await expect(page.getByRole('heading', { name: verify.pendingTitle })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    const mail = await waitForEmail(email);
    expect(mail.subject).toBe('Confirma o teu email');
    const link = linkPath(mail.text, 'verificar');

    // Not usable before verifying: no session is started.
    await page.goto('/login');
    await fillAndSubmit(page, email, PASSWORD);
    await expect(alertWith(page, login.unverifiedTitle)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/demo');
    await expect(page).toHaveURL(/\/login\?next=/);

    // The link confirms the address; now sign-in works.
    await page.goto(link);
    await expect(page.getByRole('heading', { name: verify.doneTitle })).toBeVisible();
    await page.goto('/login');
    await fillAndSubmit(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/demo$/);
  });

  test('the light theme renders the sign-up form', async ({ page, context }) => {
    await context.addCookies([{ name: 'nv-theme', value: 'light', url: E2E_OPEN_SIGNUP_ORIGIN }]);
    await page.goto('/registar');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByLabel(signup.email)).toBeVisible();
  });

  test('an email that already has an account looks the same, and its owner is warned', async ({
    page,
  }) => {
    const email = unique('existing');
    await createUser({ email, password: PASSWORD });
    await clearMailbox(email);

    await page.goto('/registar');
    await fillForm(page, { name: 'Someone Else', email, password: 'a-different-long-passphrase' });
    await page.getByRole('button', { name: signup.submit, exact: true }).click();
    await expect(page.getByRole('heading', { name: verify.pendingTitle })).toBeVisible();

    const mail = await waitForEmail(email);
    expect(mail.subject).toBe('Já tens uma conta');
    expect(mail.text).not.toMatch(/\/verificar\//);

    // The old password still works: nothing was changed.
    await page.goto('/login');
    await fillAndSubmit(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/demo$/);
  });

  test('the server rejects a common password even when the form is bypassed', async ({
    request,
  }) => {
    const response = await request.post('/api/v1/auth/sign-up/email', {
      headers: { Origin: E2E_OPEN_SIGNUP_ORIGIN },
      data: { name: 'Ana', email: unique('weak'), password: 'palavra-passe' },
    });
    expect(response.status()).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('PASSWORD_TOO_COMMON');
  });

  test('a password that contains the email is refused before the account is created', async ({
    page,
  }) => {
    const email = unique('based');
    await page.goto('/registar');
    await fillForm(page, { name: 'Ana', email, password: `xx-${email}-xx` });
    await expect(page.getByText(signup.rules.email)).toBeVisible();
    await expect(page.getByRole('button', { name: signup.submit, exact: true })).toBeDisabled();
  });
});
