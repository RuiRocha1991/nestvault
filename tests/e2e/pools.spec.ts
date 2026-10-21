import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { createUser } from './support/mailpit';
import { fillAndSubmit } from './support/sign-in';
import { E2E_POOL_ID, poolPath } from './support/user';

const pools = messages.pools;
const PASSWORD = 'a-long-unique-passphrase-for-pools';
const unique = (prefix: string) => `${prefix}-${String(Date.now())}@e2e.example.test`;
const ANY_POOL = /\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The suite uses a fresh browser context: nothing here shares the owner's stored session.
test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await fillAndSubmit(page, email, PASSWORD);
}

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

async function createPool(page: Page, name: string) {
  await page.getByLabel(pools.create.name).fill(name);
  await page.getByRole('button', { name: pools.create.submit, exact: true }).click();
}

test('a user without a pool creates the first one and lands in it', async ({ page }) => {
  const email = unique('first');
  await createUser({ email, password: PASSWORD, joinPool: false });
  await signIn(page, email);

  await expect(page).toHaveURL(/\/pools$/);
  await expect(heading(page, pools.create.title)).toBeVisible();
  const submit = page.getByRole('button', { name: pools.create.submit, exact: true });
  await expect(submit).toBeDisabled();

  await createPool(page, 'Família Nova');
  await expect(page).toHaveURL(ANY_POOL);
  const poolUrl = page.url();
  expect(poolUrl).not.toContain(E2E_POOL_ID);
  await expect(page.getByRole('navigation', { name: messages.nav.label })).toBeVisible();
  await expect(
    page.getByLabel(messages.pools.switcher.label, { exact: true }).getByText('Família Nova'),
  ).toBeVisible();
  await expect(page.getByText(pools.roles.owner)).toBeVisible();

  // Refreshing stays on the pool, and /pools now goes straight to it (the only one).
  await page.reload();
  await expect(page).toHaveURL(poolUrl);
  await page.goto('/pools');
  await expect(page).toHaveURL(poolUrl);
});

test('a name is shown as text, never as markup', async ({ page }) => {
  const email = unique('xss');
  await createUser({ email, password: PASSWORD, joinPool: false });
  await signIn(page, email);
  const name = '<img src=x onerror="window.__pwned=1">';
  await createPool(page, name);
  await expect(page).toHaveURL(ANY_POOL);
  await expect(page.getByText(name).first()).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
});

test('with two pools the chooser and the sidebar switcher let the user pick', async ({ page }) => {
  const email = unique('two');
  await createUser({ email, password: PASSWORD }); // member of the E2E pool
  await signIn(page, email);
  await expect(page).toHaveURL(new RegExp(`${E2E_POOL_ID}$`)); // the only pool: no chooser

  await page.goto('/pools/novo');
  await createPool(page, 'Casa da Praia');
  await expect(page).toHaveURL(ANY_POOL);
  const beach = page.url();

  // Two pools now: /pools opens the last one used, ?escolher=1 shows the chooser.
  await page.goto('/pools');
  await expect(page).toHaveURL(beach);
  await page.goto('/pools?escolher=1');
  await expect(heading(page, pools.chooser.title)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Casa da Praia' })).toContainText(
    pools.roles.owner,
  );
  await expect(page.getByRole('listitem').filter({ hasText: 'Família E2E' })).toContainText(
    pools.roles.member,
  );
  await page.getByRole('link', { name: pools.openLabel.replace('{name}', 'Família E2E') }).click();
  await expect(page).toHaveURL(new RegExp(`${E2E_POOL_ID}$`));

  // The sidebar switcher moves back to the other pool.
  await page.getByText('Família E2E').first().click();
  await page.getByRole('link', { name: /Casa da Praia/ }).click();
  await expect(page).toHaveURL(beach);
});

test("another user's pool and an unknown id both answer the same 404", async ({ page }) => {
  const email = unique('outsider');
  await createUser({ email, password: PASSWORD, joinPool: false });
  await signIn(page, email);
  await expect(page).toHaveURL(/\/pools$/);

  const foreign = await page.goto(poolPath());
  expect(foreign?.status()).toBe(404);
  const unknown = await page.goto('/019d0000-0000-7000-8000-00000000ffff');
  expect(unknown?.status()).toBe(404);
  const hostile = await page.goto('/%27%20OR%201%3D1%20--');
  expect(hostile?.status()).toBe(404);
});
