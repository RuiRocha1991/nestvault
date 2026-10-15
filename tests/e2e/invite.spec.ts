import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { testEnv } from '@nestvault/config/node';
import { createIdentityDatabase } from '@nestvault/db';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { clearMailbox, createUser, linkPath, waitForEmail } from './support/mailpit';
import { fillAndSubmit } from './support/sign-in';
import { E2E_ORIGIN, E2E_POOL_ID, E2E_USER, poolUrl, STORAGE_STATE } from './support/user';

const invite = messages.invite;
const signup = messages.auth.signup;
const verify = messages.auth.verify;
const roles = messages.pools.roles;
const PASSWORD = 'invite-passphrase-for-e2e-only';
const POOL_NAME = 'Família E2E';

const unique = (prefix: string) =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}@e2e.example.test`;

/** The owner invites `email` through the API (the invite dialog arrives with the members tab). */
async function inviteByApi(
  request: APIRequestContext,
  email: string,
  role: 'admin' | 'member' | 'viewer' = 'member',
): Promise<string> {
  await clearMailbox(email);
  const response = await request.post(`/api/v1/pools/${E2E_POOL_ID}/invites`, {
    headers: { Origin: E2E_ORIGIN },
    data: { email, role },
  });
  expect(response.status()).toBe(201);
  const mail = await waitForEmail(email, 15_000, 'Convite');
  return linkPath(mail.text, 'convite');
}

async function expire(email: string): Promise<void> {
  const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 1);
  try {
    await identity.db.execute(
      sql`update invites set expires_at = now() - interval '1 minute' where email = ${email}`,
    );
  } finally {
    await identity.close();
  }
}

const unavailable = (page: Page) =>
  page.getByRole('heading', { name: messages.invite.unavailable.title });

test.describe('invite links (owner invites through the API)', () => {
  test.use({ storageState: STORAGE_STATE });

  test('a person without an account registers through the invite (sign-up closed), confirms, accepts', async ({
    browser,
    request,
  }) => {
    const email = unique('newcomer');
    const link = await inviteByApi(request, email, 'member');

    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      // 58: pool, inviter, address, role, expiry
      await page.goto(`${E2E_ORIGIN}${link}`);
      await expect(page.getByRole('heading', { name: invite.title })).toBeVisible();
      await expect(page.getByText(POOL_NAME).first()).toBeVisible();
      await expect(page.getByText(`Convidado por ${E2E_USER.name}`)).toBeVisible();
      await expect(page.getByText(email)).toBeVisible();
      await expect(page.getByText(invite.roleText.member)).toBeVisible();
      await expect(page.getByRole('link', { name: invite.signIn })).toBeVisible();

      // The sign-up page is closed for everybody else, but this link opens it for this address only.
      await page.getByRole('link', { name: invite.createAccount }).click();
      await expect(page).toHaveURL(/\/convite\/[^/]+\/registar$/);
      await expect(page.getByLabel(signup.email)).toHaveValue(email);
      await expect(page.getByLabel(signup.email)).toHaveAttribute('readonly', '');
      await page.getByLabel(signup.name).fill('Joana Newcomer');
      await page.getByLabel(signup.password, { exact: true }).fill(PASSWORD);
      await page.getByLabel(signup.confirmPassword).fill(PASSWORD);
      await page.getByRole('button', { name: signup.submit, exact: true }).click();
      await expect(page.getByRole('heading', { name: verify.pendingTitle })).toBeVisible();
      await expect(page.getByText(invite.signup.afterConfirm)).toBeVisible();

      // Confirm the address, sign in through the invite page, accept.
      const verification = await waitForEmail(email, 15_000, 'Confirma');
      await page.goto(linkPath(verification.text, 'verificar'));
      await expect(page.getByRole('heading', { name: verify.doneTitle })).toBeVisible();
      await page.goto(`${E2E_ORIGIN}${link}`);
      await page.getByRole('link', { name: invite.signIn }).click();
      await expect(page).toHaveURL(/\/login\?next=%2Fconvite%2F/);
      await fillAndSubmit(page, email, PASSWORD);

      // 59: signed in with the invited address
      await expect(page.getByRole('heading', { name: invite.accept.title })).toBeVisible();
      await expect(page.getByText(email).first()).toBeVisible();
      await page.getByRole('button', { name: invite.accept.submit }).click();
      await expect(page).toHaveURL(poolUrl());

      // The link was single use: 61, with no names.
      await page.goto(`${E2E_ORIGIN}${link}`);
      await expect(unavailable(page)).toBeVisible();
      await expect(page.getByText(POOL_NAME)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('an existing user signed in with the invited address accepts and lands in the pool', async ({
    browser,
    request,
  }) => {
    const email = unique('existing');
    await createUser({ email, password: PASSWORD, joinPool: false });
    const link = await inviteByApi(request, email, 'viewer');

    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      await page.goto(`${E2E_ORIGIN}${link}`);
      await page.getByRole('link', { name: invite.signIn }).click();
      await fillAndSubmit(page, email, PASSWORD);
      await expect(page.getByRole('heading', { name: invite.accept.title })).toBeVisible();
      await expect(page.getByText(roles.viewer, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: invite.accept.submit }).click();
      await expect(page).toHaveURL(poolUrl());
    } finally {
      await context.close();
    }
  });

  test('signed in with another address: 60 asks to switch account and comes back to the invite', async ({
    browser,
    request,
  }) => {
    const invited = unique('invited');
    const other = unique('other');
    await createUser({ email: other, password: PASSWORD, joinPool: false });
    const link = await inviteByApi(request, invited, 'member');

    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      await page.goto('/login');
      await fillAndSubmit(page, other, PASSWORD);
      // Navigating away before the sign-in answered would cancel it and show the signed-out page.
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto(`${E2E_ORIGIN}${link}`);
      await expect(page.getByRole('heading', { name: invite.mismatch.title })).toBeVisible();
      await expect(page.getByText(invited).first()).toBeVisible();
      await expect(page.getByText(other).first()).toBeVisible();
      await expect(page.getByRole('button', { name: invite.accept.submit })).toHaveCount(0);

      // Nothing was accepted by looking at the page.
      await page.getByRole('button', { name: invite.mismatch.switch }).click();
      await expect(page).toHaveURL(/\/login\?next=%2Fconvite%2F/);
    } finally {
      await context.close();
    }
  });

  test('an expired, an unknown and a malformed link all show the same generic screen', async ({
    browser,
    request,
  }) => {
    const email = unique('expired');
    const link = await inviteByApi(request, email, 'member');
    await expire(email);

    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      for (const path of [link, `/convite/${'A'.repeat(43)}`, '/convite/not-a-token']) {
        await page.goto(`${E2E_ORIGIN}${path}`);
        await expect(unavailable(page)).toBeVisible();
        await expect(page.getByText(messages.invite.unavailable.text)).toBeVisible();
        await expect(page.getByText(POOL_NAME)).toHaveCount(0);
        await expect(page.getByText(email)).toHaveCount(0);
      }
      await page.getByRole('link', { name: messages.invite.unavailable.back }).click();
      await expect(page).toHaveURL(/\/login$/);

      // The sign-up page of an invalid link does not open the closed registration either.
      await page.goto(`${E2E_ORIGIN}${link}/registar`);
      await expect(unavailable(page)).toBeVisible();
      await expect(page.getByLabel(signup.email)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('the API refuses extra fields and a missing Origin, and an unknown pool is a 404', async ({
    request,
  }) => {
    const extra = await request.post(`/api/v1/pools/${E2E_POOL_ID}/invites`, {
      headers: { Origin: E2E_ORIGIN },
      data: { email: unique('extra'), role: 'member', poolId: E2E_POOL_ID },
    });
    expect(extra.status()).toBe(400);
    const noOrigin = await request.post(`/api/v1/pools/${E2E_POOL_ID}/invites`, {
      data: { email: unique('noorigin'), role: 'member' },
    });
    expect(noOrigin.status()).toBe(403);
    const unknownPool = await request.get(
      '/api/v1/pools/019d0000-0000-7000-8000-00000000dead/invites',
    );
    expect(unknownPool.status()).toBe(404);
  });
});

test.describe('layouts', () => {
  test.use({ storageState: STORAGE_STATE });

  test('screen 58 fits a phone and renders in the light theme', async ({ browser, request }) => {
    const email = unique('layout');
    const link = await inviteByApi(request, email, 'admin');
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 390, height: 844 },
    });
    await context.addCookies([{ name: 'nv-theme', value: 'light', url: E2E_ORIGIN }]);
    const page = await context.newPage();
    try {
      await page.goto(`${E2E_ORIGIN}${link}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page.getByRole('heading', { name: invite.title })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });
});
