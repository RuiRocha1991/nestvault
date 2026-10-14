import { expect, test } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { clearMailbox, createUser, linkPath, waitForEmail } from './support/mailpit';
import { fillAndSubmit } from './support/sign-in';
import { E2E_ORIGIN } from './support/user';

const forgot = messages.auth.forgot;
const reset = messages.auth.reset;
const verify = messages.auth.verify;
const OLD_PASSWORD = 'old-passphrase-for-e2e-only';
const NEW_PASSWORD = 'brand-new-passphrase-for-e2e';

// Every spec starts signed out and uses a user of its own.
test.use({ storageState: { cookies: [], origins: [] } });

const unique = (prefix: string) => `${prefix}-${String(Date.now())}@e2e.example.test`;

for (const theme of ['dark', 'light'] as const) {
  test(`reset the password from the email link, once (${theme} theme)`, async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: 'nv-theme', value: theme, url: E2E_ORIGIN }]);
    const email = unique(`reset-${theme}`);
    await createUser({ email, password: OLD_PASSWORD });
    await clearMailbox(email);

    // 52: ask for the link from the sign-in screen
    await page.goto('/login');
    await page.getByRole('link', { name: messages.auth.login.forgot }).click();
    await expect(page).toHaveURL(/\/recuperar$/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByLabel(forgot.email).fill(email);
    await page.getByRole('button', { name: forgot.submit }).click();

    // 53: the neutral confirmation, with the resend cooldown
    await expect(page.getByRole('heading', { name: forgot.sentTitle })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole('button', { name: forgot.resend })).toBeDisabled();

    // the email arrives; the link opens 54
    const mail = await waitForEmail(email);
    expect(mail.subject).toBe('Recuperar a palavra-passe');
    const link = linkPath(mail.text, 'recuperar');
    await page.goto(link);
    await expect(page.getByRole('heading', { name: reset.title })).toBeVisible();

    // a weak or mismatching password cannot be saved
    const save = page.getByRole('button', { name: reset.submit });
    await page.getByLabel(reset.newPassword, { exact: true }).fill('short');
    await expect(save).toBeDisabled();
    await page.getByLabel(reset.newPassword, { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel(reset.confirmPassword).fill(`${NEW_PASSWORD}x`);
    await expect(page.getByText(reset.mismatch)).toBeVisible();
    await expect(save).toBeDisabled();

    await page.getByLabel(reset.confirmPassword).fill(NEW_PASSWORD);
    await save.click();
    await expect(page).toHaveURL(/\/login/);

    // the new password works, the old one does not
    await fillAndSubmit(page, email, OLD_PASSWORD);
    await expect(
      page.getByRole('alert').filter({ hasText: messages.auth.login.invalidTitle }),
    ).toBeVisible();
    await fillAndSubmit(page, email, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/demo$/);

    // 55: the same link cannot be used again
    await page.context().clearCookies();
    await page.goto(link);
    await expect(page.getByRole('heading', { name: reset.invalidTitle })).toBeVisible();
    await page.getByRole('link', { name: reset.requestNew }).click();
    await expect(page).toHaveURL(/\/recuperar$/);

    // the owner is told by email
    const notice = await waitForEmail(email);
    expect(notice.subject).toBeTruthy();
  });
}

test('an unknown email gets the same confirmation and no email', async ({ page }) => {
  const email = unique('nobody');
  await clearMailbox(email);
  await page.goto('/recuperar');
  await page.getByLabel(forgot.email).fill(email);
  await page.getByRole('button', { name: forgot.submit }).click();
  await expect(page.getByRole('heading', { name: forgot.sentTitle })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await page.waitForTimeout(1000);
  const response = await fetch(
    `http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  expect(((await response.json()) as { messages_count: number }).messages_count).toBe(0);
});

test('a made-up reset link shows the invalid screen', async ({ page }) => {
  await page.goto('/recuperar/not-a-real-token-0123456789');
  await expect(page.getByRole('heading', { name: reset.invalidTitle })).toBeVisible();
});

test('the verification link confirms the email, and a made-up one is refused', async ({
  page,
  request,
}) => {
  const email = unique('verify');
  await createUser({ email, password: OLD_PASSWORD, verified: false });
  await clearMailbox(email);

  const sent = await request.post('/api/v1/auth/send-verification-email', {
    headers: { Origin: E2E_ORIGIN },
    data: { email },
  });
  expect(sent.status()).toBe(200);
  const mail = await waitForEmail(email);
  expect(mail.subject).toBe('Confirma o teu email');

  await page.goto(linkPath(mail.text, 'verificar'));
  await expect(page.getByRole('heading', { name: verify.doneTitle })).toBeVisible();

  await page.goto('/verificar/not-a-real-token');
  await expect(page.getByRole('heading', { name: verify.invalidTitle })).toBeVisible();
});

test('"confirm your email" needs a session', async ({ page }) => {
  await page.goto('/verificar');
  await expect(page).toHaveURL(/\/login\?next=%2Fverificar$/);
});
