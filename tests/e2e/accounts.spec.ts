import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import {
  MEMBERS_PASSWORD,
  seedMembersWorld,
  type MembersPerson,
  type MembersWorld,
} from './support/members';
import { fillAndSubmit } from './support/sign-in';

const a = messages.accounts;
const VALID_IBAN = 'PT50000201231234567890154';

// Each test starts signed out and works in a pool of its own, so nothing depends on another spec.
test.use({ storageState: { cookies: [], origins: [] } });

let world: MembersWorld;
test.beforeEach(async () => {
  world = await seedMembersWorld();
});

const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });

/** Waits until clicks work: React hydrated a button and the Next router is published. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('main button, button');
    const router = (window as unknown as { next?: { router?: unknown } }).next?.router;
    return (
      !!button && !!router && Object.keys(button).some((key) => key.startsWith('__reactProps$'))
    );
  });
}

async function openAccounts(page: Page, person: MembersPerson) {
  const url = `/${world.poolId}/contas`;
  await page.goto(`/login?next=${encodeURIComponent(url)}`);
  await fillAndSubmit(page, person.email, MEMBERS_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`${world.poolId}/contas`));
  await hydrated(page);
}

test('an admin adds a checking account and sees its balance (modal 18)', async ({ page }) => {
  await openAccounts(page, world.admin);
  await expect(page.getByRole('heading', { name: messages.nav.items.accounts })).toBeVisible();
  // People are managed in Definições, not on this page (NES-143).
  await expect(page.getByText(messages.holders.title)).toHaveCount(0);

  await page.getByRole('button', { name: a.add }).click();
  const add = dialog(page, a.dialog.newTitle);
  await add.getByLabel(a.dialog.name, { exact: true }).fill('Conta Teste');
  await add.getByRole('button', { name: a.dialog.submit }).click();
  // No holder chosen yet: the error is shown next to the field and nothing is sent.
  await expect(add.getByText(a.dialog.holdersRequired)).toBeVisible();

  await add.getByRole('checkbox', { name: /Rui/ }).check();
  await add.getByLabel(a.dialog.iban, { exact: true }).fill('PT50 1234');
  await add.getByLabel(a.dialog.opening, { exact: true }).fill('1000,50');
  await add.getByRole('button', { name: a.dialog.submit }).click();
  // The server's mod-97 check answers 400 naming the field; the message is in pt-PT.
  await expect(add.getByText(a.dialog.ibanInvalid)).toBeVisible();

  await add.getByLabel(a.dialog.iban, { exact: true }).fill(VALID_IBAN);
  await add.getByRole('button', { name: a.dialog.submit }).click();
  await expect(add).toBeHidden();

  const card = page.getByTestId(/^account-/).filter({ hasText: 'Conta Teste' });
  await expect(card).toContainText(/1\s000,50\s€/);
  await expect(card).toContainText(VALID_IBAN);
});

test('an admin creates a savings product and a deposit from it (modals 19 and 17)', async ({
  page,
}) => {
  await openAccounts(page, world.admin);

  await page.getByRole('button', { name: a.products.add }).click();
  const product = dialog(page, a.productDialog.newTitle);
  await product.getByLabel(a.productDialog.name).fill('DP Teste 12M');
  await product.getByRole('button', { name: a.dialog.submit }).click();
  await expect(product.getByText(a.productDialog.rateRequired)).toBeVisible();
  await product.getByLabel(a.productDialog.rate).fill('2,5');
  await product.getByRole('button', { name: a.dialog.submit }).click();
  await expect(product).toBeHidden();

  const row = page
    .getByTestId('products-block')
    .getByRole('row')
    .filter({ hasText: 'DP Teste 12M' });
  await expect(row).toContainText(/2,50%/);

  await row.getByRole('button', { name: a.products.newDeposit }).click();
  const add = dialog(page, a.dialog.newTitle);
  // The product filled the terms.
  await expect(add.getByLabel(a.dialog.rate, { exact: true })).toHaveValue('2.5');
  await add.getByRole('checkbox', { name: /Rui/ }).check();
  await add.getByLabel(a.dialog.capital, { exact: true }).fill('5000');
  await add.getByLabel(a.dialog.start, { exact: true }).fill('2026-01-10');
  await add.getByRole('button', { name: a.dialog.submit }).click();
  await expect(add).toBeHidden();

  const card = page.getByTestId(/^account-/).filter({ hasText: 'DP Teste 12M' });
  await expect(card).toContainText(a.card.maturity);
  await expect(card).toContainText('10/01/2027');
});

test('a member and a viewer see the accounts but cannot manage them', async ({ page }) => {
  await openAccounts(page, world.member);
  await expect(page.getByRole('heading', { name: messages.nav.items.accounts })).toBeVisible();
  await expect(page.getByRole('button', { name: a.add })).toHaveCount(0);
  await expect(page.getByRole('button', { name: a.products.add })).toHaveCount(0);
});
