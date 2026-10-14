import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { clearMailbox, createUser, linkPath, waitForEmail } from './support/mailpit';
import { fillAndSubmit } from './support/sign-in';
import { E2E_ORIGIN } from './support/user';

const account = messages.account;
const PASSWORD = 'account-passphrase-for-e2e-only';
const NEW_PASSWORD = 'brand-new-account-passphrase-e2e';

// Every test starts signed out and uses a user of its own.
test.use({ storageState: { cookies: [], origins: [] } });

/** Signs in through the form and waits until the app has loaded. */
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await fillAndSubmit(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/demo$/);
}

const unique = (prefix: string) => `${prefix}-${String(Date.now())}@e2e.example.test`;

for (const theme of ['dark', 'light'] as const) {
  test(`the account page shows profile, password, sessions and the 2FA placeholder (${theme} theme)`, async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: 'nv-theme', value: theme, url: E2E_ORIGIN }]);
    const email = unique(`page-${theme}`);
    await createUser({ email, password: PASSWORD });

    await signIn(page, email);
    await page.goto('/conta');

    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('heading', { name: account.title, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: account.profile.title })).toBeVisible();
    await expect(page.getByText(account.profile.verified, { exact: true })).toBeVisible();
    await expect(page.getByLabel(account.profile.email)).toHaveValue(email);
    await expect(page.getByRole('heading', { name: account.password.title })).toBeVisible();
    await expect(page.getByRole('heading', { name: account.sessions.title })).toBeVisible();
    await expect(page.getByText(account.sessions.current, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: account.twoFactor.title })).toBeVisible();
    await expect(page.getByRole('button', { name: account.twoFactor.activate })).toBeDisabled();
  });
}

test('changes the name and asks for the new email to be confirmed', async ({ page }) => {
  const email = unique('profile');
  const newEmail = unique('profile-new');
  await createUser({ email, password: PASSWORD });
  await clearMailbox(newEmail);
  await signIn(page, email);
  await page.goto('/conta');

  const save = page.getByRole('button', { name: account.profile.save });
  await expect(save).toBeDisabled();
  await page.getByLabel(account.profile.name).fill('Nome Novo');
  await save.click();
  await expect(page.getByText(account.profile.saved)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(account.profile.name)).toHaveValue('Nome Novo');

  await page.getByLabel(account.profile.email).fill(newEmail);
  await save.click();
  await expect(
    page.getByText('O email só muda depois de a abrires.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel(account.profile.email)).toHaveValue(email);

  // The link goes to the new address, and only using it changes the email.
  const mail = await waitForEmail(newEmail);
  await page.goto(linkPath(mail.text, 'verificar'));
  await page.goto('/conta');
  await expect(page.getByLabel(account.profile.email)).toHaveValue(newEmail);
});

test('a wrong current password is refused; the right one ends the other sessions', async ({
  page,
  browser,
}) => {
  const email = unique('password');
  await createUser({ email, password: PASSWORD });
  await signIn(page, email);

  const other = await browser.newContext({ baseURL: E2E_ORIGIN });
  const otherPage = await other.newPage();
  await otherPage.goto('/login');
  await fillAndSubmit(otherPage, email, PASSWORD);
  await expect(otherPage).toHaveURL(/\/demo$/);

  await page.goto('/conta');
  const current = page.getByLabel(account.password.current);
  await current.fill('not-the-right-passphrase');
  await page.getByLabel(account.password.new, { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel(account.password.confirm, { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: account.password.submit }).click();
  await expect(page.getByText(account.password.wrongCurrent)).toBeVisible();

  await current.fill(PASSWORD);
  await page.getByRole('button', { name: account.password.submit }).click();
  await expect(page.getByText(account.password.saved)).toBeVisible();

  // This browser stays signed in; the other one is sent to the sign-in screen.
  await page.reload();
  await expect(page.getByRole('heading', { name: account.title, level: 1 })).toBeVisible();
  await otherPage.goto('/conta');
  await expect(otherPage).toHaveURL(/\/login/);
  await other.close();

  const notice = await waitForEmail(email);
  expect(notice.subject).toBe('A tua palavra-passe foi alterada');
});

test('ends one session, then all the others', async ({ page, browser }) => {
  const email = unique('sessions');
  await createUser({ email, password: PASSWORD });
  await signIn(page, email);

  const makeSession = async () => {
    const context = await browser.newContext({ baseURL: E2E_ORIGIN });
    const other = await context.newPage();
    await other.goto('/login');
    await fillAndSubmit(other, email, PASSWORD);
    await expect(other).toHaveURL(/\/demo$/);
    return { context, other };
  };
  const first = await makeSession();
  const second = await makeSession();

  await page.goto('/conta');
  const ends = page.getByRole('button', { name: /^Terminar a sessão em/ });
  await expect(ends).toHaveCount(2);

  await ends.first().click();
  await expect(ends).toHaveCount(1);
  await page.getByRole('button', { name: account.sessions.endOthers }).click();
  await expect(ends).toHaveCount(0);
  await expect(page.getByText(account.sessions.current, { exact: true })).toBeVisible();

  for (const { context, other } of [first, second]) {
    await other.goto('/conta');
    await expect(other).toHaveURL(/\/login/);
    await context.close();
  }
});

test('the account page needs a session', async ({ page }) => {
  await page.goto('/conta');
  await expect(page).toHaveURL(/\/login\?next=%2Fconta/);
});
