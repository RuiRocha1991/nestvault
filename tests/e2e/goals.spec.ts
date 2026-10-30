import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { MEMBERS_PASSWORD, seedMembersWorld, type MembersWorld } from './support/members';
import { fillAndSubmit } from './support/sign-in';
import { E2E_ORIGIN } from './support/user';

const g = messages.goals;
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/prototype-export.anonymized.json', import.meta.url), 'utf8'),
) as unknown;

// Each test starts signed out and works in a pool of its own, so nothing depends on another spec.
test.use({ storageState: { cookies: [], origins: [] } });

let world: MembersWorld;
test.beforeEach(async () => {
  world = await seedMembersWorld();
});

async function signIn(page: Page, email: string) {
  const url = `/${world.poolId}/objetivos`;
  await page.goto(`/login?next=${encodeURIComponent(url)}`);
  await fillAndSubmit(page, email, MEMBERS_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`${world.poolId}/objetivos`));
}

/** Imports the anonymized prototype export (two goals) into the pool as its owner. */
async function importPrototype(page: Page) {
  const response = await page.request.post(`/api/v1/pools/${world.poolId}/import-prototype`, {
    headers: { Origin: E2E_ORIGIN },
    data: { dryRun: false, export: fixture },
  });
  expect(response.status()).toBe(200);
}

test('a pool without goals shows the empty state and lets the owner create the first one', async ({
  page,
}) => {
  await signIn(page, world.owner.email);
  await expect(page.getByRole('heading', { name: messages.nav.items.goals })).toBeVisible();
  await expect(page.getByText(g.empty)).toBeVisible();

  await page.getByRole('button', { name: g.new }).click();
  const dialog = page.getByRole('dialog', { name: g.dialog.newTitle });
  await dialog.getByLabel(g.dialog.name).fill('Fundo de emergência');
  await dialog.getByLabel(g.dialog.target).fill('20 000,50');
  await dialog.getByRole('button', { name: g.dialog.create }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Fundo de emergência' })).toBeVisible();
  await expect(page.getByRole('list', { name: g.list }).getByText('20 000,50')).toBeVisible();
});

test('the imported goals show their numbers and the projection, and can be edited and deleted', async ({
  page,
}) => {
  await signIn(page, world.owner.email);
  await importPrototype(page);
  await page.reload();

  const cards = page.getByRole('list', { name: g.list }).getByRole('article');
  await expect(cards).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Independência financeira' })).toBeVisible();
  await expect(cards.first().getByText('300 000,00')).toBeVisible();
  await expect(page.getByRole('img', { name: g.chart.label })).toBeVisible();
  await page.screenshot({ path: 'test-results/goals-screen.png', fullPage: true });

  await page.getByRole('button', { name: g.edit }).click();
  const dialog = page.getByRole('dialog', { name: g.dialog.editTitle });
  await expect(dialog.getByLabel(g.dialog.name)).toHaveValue('Independência financeira');
  await dialog.getByLabel(g.dialog.name).fill('Reforma');
  await dialog.getByRole('button', { name: g.dialog.save }).click();
  await expect(page.getByRole('heading', { name: 'Reforma' }).first()).toBeVisible();

  await page.getByRole('button', { name: g.delete }).click();
  await page
    .getByRole('dialog', { name: g.confirmDelete.title })
    .getByRole('button', { name: g.confirmDelete.confirm })
    .click();
  await expect(cards).toHaveCount(1);
});

test('the overview card shows the same goals', async ({ page }) => {
  await signIn(page, world.owner.email);
  await importPrototype(page);
  await page.goto(`/${world.poolId}/visao-geral`);
  await expect(page.getByText('Independência financeira')).toBeVisible();
});

test('a viewer sees the goals without the write buttons', async ({ page }) => {
  await signIn(page, world.owner.email);
  await importPrototype(page);
  await page.context().clearCookies();
  await signIn(page, world.viewer.email);
  await expect(page.getByRole('heading', { name: 'Independência financeira' })).toBeVisible();
  await expect(page.getByRole('button', { name: g.new })).toHaveCount(0);
  await expect(page.getByRole('button', { name: g.edit })).toHaveCount(0);
  await expect(page.getByRole('button', { name: g.delete })).toHaveCount(0);
});
