import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { MEMBERS_PASSWORD, seedMembersWorld, type MembersWorld } from './support/members';
import { fillAndSubmit } from './support/sign-in';
import { E2E_ORIGIN } from './support/user';

const o = messages.overview;
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/prototype-export.anonymized.json', import.meta.url), 'utf8'),
) as unknown;

// Each test starts signed out and works in a pool of its own, so nothing depends on another spec.
test.use({ storageState: { cookies: [], origins: [] } });

let world: MembersWorld;
test.beforeEach(async () => {
  world = await seedMembersWorld();
});

async function signIn(page: Page, email: string, path = '/visao-geral') {
  const url = `/${world.poolId}${path}`;
  await page.goto(`/login?next=${encodeURIComponent(url)}`);
  await fillAndSubmit(page, email, MEMBERS_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`${world.poolId}${path.replace('?', '\\?')}`));
}

/** Imports the anonymized prototype export into the pool as its owner (the page holds the session). */
async function importPrototype(page: Page) {
  const response = await page.request.post(`/api/v1/pools/${world.poolId}/import-prototype`, {
    headers: { Origin: E2E_ORIGIN },
    data: { dryRun: false, export: fixture },
  });
  expect(response.status()).toBe(200);
}

test('a new pool shows the call to action instead of empty cards', async ({ page }) => {
  await signIn(page, world.owner.email);
  await expect(page.getByRole('heading', { name: messages.nav.items.overview })).toBeVisible();
  await expect(page.getByText(o.welcomeTitle)).toBeVisible();
  await expect(page.getByRole('link', { name: o.createAccount })).toBeVisible();
  await expect(page.getByText(o.kpi.netWorth)).toHaveCount(0);
});

test('the pool root shows the same overview as /visao-geral', async ({ page }) => {
  await signIn(page, world.owner.email, '');
  await expect(page.getByText(o.welcomeTitle)).toBeVisible();
});

test('the overview of the prototype data shows the KPIs, the chart and the cards', async ({
  page,
}) => {
  await signIn(page, world.owner.email);
  await importPrototype(page);
  await page.reload();

  for (const title of [o.kpi.netWorth, o.kpi.investments, o.kpi.passiveIncome, o.kpi.monthExpenses]) {
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  // The fixture's positions are worth 2 114 EUR (the NES-47 reference value).
  await expect(page.getByText(/^2\s114\s€$/).first()).toBeVisible();
  await expect(page.getByRole('img', { name: o.evolution.chartLabel })).toBeVisible();
  await expect(page.getByRole('heading', { name: o.portfolios.title })).toBeVisible();
  await expect(page.getByRole('heading', { name: o.expenses.title })).toBeVisible();
  await expect(page.getByRole('heading', { name: o.dividends.title })).toBeVisible();

  // The period lives in the URL and survives a reload.
  await page.getByLabel(o.evolution.period).selectOption('24');
  await expect(page).toHaveURL(/periodo=24/);
  await page.reload();
  await expect(page.getByLabel(o.evolution.period)).toHaveValue('24');
});

test('a viewer sees the overview without the write buttons', async ({ page }) => {
  await signIn(page, world.owner.email);
  await importPrototype(page);
  await page.context().clearCookies();

  await signIn(page, world.viewer.email);
  await expect(page.getByRole('heading', { name: o.kpi.netWorth, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: messages.shell.newTransaction })).toHaveCount(0);
  await expect(page.getByRole('link', { name: o.portfolios.new })).toHaveCount(0);

  await page.context().clearCookies();
  await signIn(page, world.member.email);
  await expect(page.getByRole('link', { name: messages.shell.newTransaction })).toBeVisible();
  await expect(page.getByRole('link', { name: o.portfolios.new })).toHaveCount(0);
});

test('the search box finds movements by description', async ({ page }) => {
  await signIn(page, world.owner.email);
  await importPrototype(page);
  await page.reload();

  await page.getByRole('searchbox', { name: o.header.searchLabel }).fill('CONTINENTE');
  await page.getByRole('searchbox', { name: o.header.searchLabel }).press('Enter');
  await expect(page).toHaveURL(/\/pesquisa\?q=CONTINENTE/);
  await expect(page.getByRole('heading', { name: messages.search.title })).toBeVisible();
  await expect(page.getByText(messages.search.resultsFor.replace('{query}', 'CONTINENTE'))).toBeVisible();
});

// The mockup (01-visao-geral) is the layout reference. Its data is the owner's real one, so pixels
// cannot match; what is compared is the geometry: four equal KPI cards on one row, the evolution
// card about two thirds of the width next to the goals card, and three equal cards below. Each
// proportion is allowed to differ by 3 percentage points from the mockup, and each row must start
// within 4 px of the same top. The screenshots are attached to the report for a visual review.
for (const theme of ['dark', 'light'] as const) {
  test(`the layout follows the mockup in the ${theme} theme`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1081 });
    await page.context().addCookies([{ name: 'nv-theme', value: theme, url: E2E_ORIGIN }]);
    await signIn(page, world.owner.email);
    await importPrototype(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: o.kpi.netWorth, exact: true })).toBeVisible();

    const card = async (title: string) => {
      const box = await page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
        .first()
        .boundingBox();
      if (!box) throw new Error(`no card ${title}`);
      return box;
    };
    const [net, inv, inc, exp] = await Promise.all(
      [o.kpi.netWorth, o.kpi.investments, o.kpi.passiveIncome, o.kpi.monthExpenses].map(card),
    );
    const [evolution, goals, portfolios, expenses, dividends] = await Promise.all(
      [o.evolution.title, o.goals.title, o.portfolios.title, o.expenses.title, o.dividends.title].map(
        card,
      ),
    );
    if (!net || !inv || !inc || !exp || !evolution || !goals || !portfolios || !expenses || !dividends) {
      throw new Error('missing card');
    }

    const row = net.width + inv.width + inc.width + exp.width;
    const total = exp.x + exp.width - net.x;
    expect([net.y, inv.y, inc.y, exp.y].every((y) => Math.abs(y - net.y) <= 4)).toBe(true);
    expect(Math.abs(net.width / row - 0.25)).toBeLessThan(0.03);
    expect(Math.abs(exp.width / row - 0.25)).toBeLessThan(0.03);

    // Mockup: the evolution card is 8 of 12 columns, the goals card 4.
    expect(Math.abs(evolution.y - goals.y)).toBeLessThanOrEqual(4);
    expect(Math.abs(evolution.width / total - 2 / 3)).toBeLessThan(0.03);
    expect(Math.abs(goals.width / total - 1 / 3)).toBeLessThan(0.03);
    // The row below starts under the evolution card, with three equal cards.
    expect(portfolios.y).toBeGreaterThan(evolution.y + evolution.height - 1);
    expect([portfolios.y, expenses.y, dividends.y].every((y) => Math.abs(y - portfolios.y) <= 4)).toBe(
      true,
    );
    for (const third of [portfolios, expenses, dividends]) {
      expect(Math.abs(third.width / total - 1 / 3)).toBeLessThan(0.03);
    }

    await testInfo.attach(`overview-${theme}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}
