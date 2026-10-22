import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { MEMBERS_PASSWORD, seedMembersWorld } from './support/members';
import { exportWithObras } from './support/obras-fixture';
import { fillAndSubmit } from './support/sign-in';
import { E2E_ORIGIN } from './support/user';

const p = messages.portfolios;
const s = p.summary;

// Each test starts signed out and works in a pool of its own, so nothing depends on another spec.
test.use({ storageState: { cookies: [], origins: [] } });

/** A pool with the prototype fixture and an "Obras": accounts only, no assets, no dividends. */
async function openPool(page: Page) {
  const world = await seedMembersWorld();
  await page.goto(`/login?next=${encodeURIComponent(`/${world.poolId}`)}`);
  await fillAndSubmit(page, world.owner.email, MEMBERS_PASSWORD);
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  const imported = await page.request.post(`/api/v1/pools/${world.poolId}/import-prototype`, {
    headers: { Origin: E2E_ORIGIN },
    data: { dryRun: false, export: exportWithObras() },
  });
  expect(imported.status()).toBe(200);
  const { portfolios } = (await (
    await page.request.get(`/api/v1/pools/${world.poolId}/portfolios`)
  ).json()) as { portfolios: { id: string; name: string }[] };
  const id = (name: string) => portfolios.find((x) => x.name === name)?.id ?? '';
  return { poolId: world.poolId, obras: id('Obras'), longo: id('Longo prazo') };
}

const tabs = (page: Page) => page.getByRole('navigation', { name: p.tabsLabel });

test('a portfolio with accounts only mentions no dividends anywhere and has no Dividendos tab', async ({
  page,
}) => {
  const { poolId, obras } = await openPool(page);
  await page.goto(`/${poolId}/portfolios/${obras}`);
  await expect(page.getByRole('heading', { name: 'Obras', level: 1 })).toBeVisible();

  // Resumo: the accounts table and a chart with history (the accounts' balance), no position blocks.
  await expect(page.getByRole('heading', { name: s.accounts.title })).toBeVisible();
  await expect(page.getByRole('img', { name: s.performance.title })).toBeVisible();
  await expect(page.getByText(s.performance.empty)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: s.top.title })).toHaveCount(0);
  await expect(page.getByText(s.passiveIncome, { exact: true })).toHaveCount(0);
  await expect(page.getByText(s.dividendsReceived)).toHaveCount(0);
  await expect(page.getByText(s.taxWithheld)).toHaveCount(0);

  // The tab bar has the four other tabs only.
  await expect(tabs(page).getByRole('link', { name: p.tabs.dividends })).toHaveCount(0);
  for (const tab of ['summary', 'positions', 'transactions', 'analysis'] as const) {
    await expect(tabs(page).getByRole('link', { name: p.tabs[tab] })).toBeVisible();
  }

  // No tab of the portfolio says "dividend" in any form.
  for (const tab of ['', '?tab=positions', '?tab=transactions', '?tab=analysis']) {
    await page.goto(`/${poolId}/portfolios/${obras}${tab}`);
    await expect(page.getByRole('heading', { name: 'Obras', level: 1 })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/dividend/i);
  }

  // The Dividendos URL, opened directly, shows the Resumo instead of an error.
  await page.goto(`/${poolId}/portfolios/${obras}?tab=dividends`);
  await expect(page.getByRole('heading', { name: s.accounts.title })).toBeVisible();
  await expect(tabs(page).getByRole('link', { name: p.tabs.summary })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('a portfolio with dividends still shows them, and so does "Todos"', async ({ page }) => {
  const { poolId, longo } = await openPool(page);
  await page.goto(`/${poolId}/portfolios/${longo}`);
  await expect(page.getByText(s.passiveIncome, { exact: true })).toBeVisible();
  await expect(page.getByText(s.dividendsReceived)).toBeVisible();
  await expect(page.getByRole('heading', { name: s.forecast.title })).toBeVisible();
  await expect(tabs(page).getByRole('link', { name: p.tabs.dividends })).toBeVisible();

  await tabs(page).getByRole('link', { name: p.tabs.dividends }).click();
  await expect(page).toHaveURL(/tab=dividends/);
  await expect(page.getByRole('heading', { name: p.dividends.perMonth })).toBeVisible();

  await page.goto(`/${poolId}/portfolios`);
  await expect(tabs(page).getByRole('link', { name: p.tabs.dividends })).toBeVisible();
});

test('the overview keeps its dividends card while the pool has dividends', async ({ page }) => {
  const { poolId } = await openPool(page);
  await page.goto(`/${poolId}`);
  await expect(
    page.getByRole('heading', { name: messages.overview.dividends.title }),
  ).toBeVisible();
});
