import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import {
  MEMBERS_PASSWORD,
  seedMembersWorld,
  type MembersPerson,
  type MembersWorld,
} from './support/members';
import { fillAndSubmit } from './support/sign-in';

const p = messages.parameters;
const rateLabel = (currency: string) => p.rate.replace('{currency}', currency);

// Each test starts signed out and works in a pool of its own, so nothing depends on another spec.
test.use({ storageState: { cookies: [], origins: [] } });

let world: MembersWorld;
test.beforeEach(async () => {
  world = await seedMembersWorld();
});

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

async function openSettings(page: Page, person: MembersPerson) {
  const url = `/${world.poolId}/definicoes`;
  await page.goto(`/login?next=${encodeURIComponent(url)}`);
  await fillAndSubmit(page, person.email, MEMBERS_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`${world.poolId}/definicoes`));
  await hydrated(page);
}

test('an admin sees the defaults, saves new parameters and finds them after a reload', async ({
  page,
}) => {
  await openSettings(page, world.admin);
  await expect(page.getByRole('heading', { name: p.title })).toBeVisible();
  await expect(page.getByLabel(rateLabel('USD'))).toHaveValue('0,92');
  await expect(page.getByLabel(p.depositTax)).toHaveValue('28');
  await expect(page.getByLabel(p.transferWindow)).toHaveValue('3');

  await page.getByLabel(rateLabel('USD')).fill('0,95');
  await page.getByLabel(p.depositTax).fill('25');
  await page.getByLabel(p.transferWindow).fill('5');
  await page.getByRole('button', { name: p.save }).click();
  await expect(page.getByText(p.saved)).toBeVisible();

  await page.reload();
  await hydrated(page);
  await expect(page.getByLabel(rateLabel('USD'))).toHaveValue('0,95');
  await expect(page.getByLabel(rateLabel('GBP'))).toHaveValue('1,17');
  await expect(page.getByLabel(p.depositTax)).toHaveValue('25');
  await expect(page.getByLabel(p.transferWindow)).toHaveValue('5');
  // The household note follows the saved window.
  await expect(page.getByText(/até 5 dias/)).toBeVisible();
});

test('a value the server refuses shows the problem and keeps what was typed', async ({ page }) => {
  await openSettings(page, world.owner);
  await page.getByLabel(p.depositTax).fill('150');
  await page.getByRole('button', { name: p.save }).click();
  await expect(page.getByText(p.invalidTitle)).toBeVisible();
  await expect(page.getByLabel(p.depositTax)).toHaveValue('150');
});

test('a viewer sees the parameters but has no way to save them', async ({ page }) => {
  await openSettings(page, world.viewer);
  await expect(page.getByLabel(p.depositTax)).toHaveValue('28');
  await expect(page.getByLabel(p.depositTax)).not.toBeEditable();
  await expect(page.getByRole('button', { name: p.save })).toHaveCount(0);
});

test.describe('layout', () => {
  async function boxes(page: Page) {
    const cells = page.getByTestId('settings-grid').locator('> *');
    await expect(cells).toHaveCount(2);
    const a = await cells.nth(0).boundingBox();
    const b = await cells.nth(1).boundingBox();
    if (!a || !b) throw new Error('the settings cards have no layout box');
    return { a, b };
  }

  test('desktop: the household data and parameters cards sit side by side', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSettings(page, world.owner);
    const { a, b } = await boxes(page);
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(Math.abs(a.width - b.width)).toBeLessThan(4);
  });

  test('phone: the cards stack and the page does not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSettings(page, world.owner);
    const { a, b } = await boxes(page);
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    expect(Math.abs(a.x - b.x)).toBeLessThan(2);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test('the settings page logs no console error for the owner, import card included', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await openSettings(page, world.owner);
  await expect(page.getByRole('heading', { name: messages.importPrototype.title })).toBeVisible();
  expect(problems).toEqual([]);
});
