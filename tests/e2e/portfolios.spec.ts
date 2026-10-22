import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { MEMBERS_PASSWORD, seedMembersWorld, type MembersWorld } from './support/members';
import { fillAndSubmit } from './support/sign-in';
import { E2E_ORIGIN } from './support/user';

const p = messages.portfolios;
const NAV = messages.nav.label;

// Each test starts signed out and works in a pool of its own, so nothing depends on another spec.
test.use({ storageState: { cookies: [], origins: [] } });

let world: MembersWorld;
test.beforeEach(async () => {
  world = await seedMembersWorld();
});

async function signIn(page: Page, path = '/portfolios') {
  const url = `/${world.poolId}${path}`;
  await page.goto(`/login?next=${encodeURIComponent(url)}`);
  await fillAndSubmit(page, world.owner.email, MEMBERS_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`${world.poolId}${path}`));
}

async function api<T>(page: Page, path: string, data?: unknown): Promise<T> {
  const url = `/api/v1/pools/${world.poolId}${path}`;
  const response = data
    ? await page.request.post(url, { headers: { Origin: E2E_ORIGIN }, data })
    : await page.request.get(url);
  expect(response.ok()).toBe(true);
  return (await response.json()) as T;
}

/** The XTB reference fixture: a USD ETF (ten bought at 120, priced 135.062), three dividends, 11.25 in cash. */
async function seedXtb(page: Page) {
  const portfolio = await api<{ id: string }>(page, '/portfolios', {
    name: 'XTB',
    color: '#9d6bff',
    currency: 'USD',
  });
  const asset = await api<{ id: string }>(page, '/assets', {
    ticker: 'ETFUSD',
    name: 'ETF em dólares',
    type: 'etf',
    currency: 'USD',
  });
  await api(page, `/assets/${asset.id}/prices`, { date: '2026-01-02', price: '135.062' });
  const { holders } = await api<{ holders: { id: string }[] }>(page, '/holders');
  const account = await api<{ id: string }>(page, '/accounts', {
    type: 'brokerage',
    name: 'XTB',
    currency: 'USD',
    opening: '1146.95',
    holderIds: [holders[0]?.id],
  });
  const base = { portfolioId: portfolio.id, assetId: asset.id, accountId: account.id };
  await api(page, '/ops', { ...base, type: 'buy', date: '2025-01-10', qty: '10', price: '120' });
  for (const [date, amount, gross, tax] of [
    ['2025-06-10', '34', '40', '6'],
    ['2025-12-10', '26.06', '30.75', '4.69'],
    ['2026-02-10', '4.24', '0', '-4.24'],
  ]) {
    await api(page, '/ops', { ...base, type: 'dividend', date, amount, gross, tax });
  }
  return portfolio.id;
}

const MONEY_USD = /1\s361,87\s(US\$)/;
const MONEY_EUR = /1\s252,92\s€/;

test('the currency choice is in the URL and applies to every tab, also after a refresh', async ({
  page,
}) => {
  await signIn(page);
  const id = await seedXtb(page);
  await page.goto(`/${world.poolId}/portfolios/${id}`);

  const group = page.getByRole('group', { name: p.currency.label });
  const own = group.getByRole('button', { name: p.currency.portfolio });
  const base = group.getByRole('button', { name: p.currency.base });

  // Default: the portfolio's own currency (XTB reference: 1361,87 US$).
  await expect(own).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(MONEY_USD).first()).toBeVisible();

  // Base currency: the same value converted with the pool's rate, with its source and date.
  await base.click();
  await expect(page).toHaveURL(/moeda=base/);
  await expect(page.getByText(MONEY_EUR).first()).toBeVisible();
  await expect(page.getByText(/1\sUS\$ = 0,9200\s€/)).toBeVisible();
  // The portfolio chip keeps the portfolio's own currency; the figures below it do not.
  await expect(page.locator('b').filter({ hasText: MONEY_USD })).toHaveCount(0);

  // The choice follows the tab links and survives a refresh.
  const tabs = page.getByRole('navigation', { name: p.tabsLabel });
  for (const tab of ['positions', 'dividends', 'transactions', 'analysis'] as const) {
    await tabs.getByRole('link', { name: p.tabs[tab] }).click();
    await expect(page).toHaveURL(new RegExp(`tab=${tab}&moeda=base`));
    await expect(base).toHaveAttribute('aria-pressed', 'true');
  }
  await tabs.getByRole('link', { name: p.tabs.positions }).click();
  await expect(page.getByText(/1\s242,57\s€/).first()).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/tab=positions&moeda=base/);
  await expect(base).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/1\s242,57\s€/).first()).toBeVisible();

  // Back to the portfolio's currency.
  await own.click();
  await expect(page).not.toHaveURL(/moeda/);
  await expect(page.getByText(/1\s350,62\sUS\$/).first()).toBeVisible();
});

test('all portfolios are fixed to the base currency, with a hint', async ({ page }) => {
  await signIn(page);
  await seedXtb(page);
  await page.goto(`/${world.poolId}/portfolios?moeda=portfolio`);

  const group = page.getByRole('group', { name: p.currency.label });
  await expect(group.getByRole('button', { name: p.currency.base })).toBeDisabled();
  await expect(group.getByRole('button', { name: p.currency.portfolio })).toBeDisabled();
  await expect(page.getByText(p.currency.fixedHint.replace('{currency}', 'EUR'))).toBeVisible();
  await expect(page.getByText(MONEY_EUR).first()).toBeVisible();
});

test('the sidebar lists the portfolios and follows creating, renaming and deleting', async ({
  page,
}) => {
  await signIn(page);
  const id = await seedXtb(page);
  await page.goto(`/${world.poolId}/portfolios`);

  const nav = page.getByRole('navigation', { name: NAV });
  const all = nav.getByRole('link', { name: messages.nav.items.portfolios, exact: true });
  const xtb = nav.getByRole('link', { name: 'XTB', exact: true });
  await expect(xtb).toHaveAttribute('href', `/${world.poolId}/portfolios/${id}`);
  await expect(all).toHaveAttribute('aria-current', 'page');

  // A portfolio of its own highlights its child item, not "Portfolios".
  await xtb.click();
  await expect(xtb).toHaveAttribute('aria-current', 'page');
  await expect(all).not.toHaveAttribute('aria-current', 'page');

  // Create (no reload): the new item appears in the sidebar.
  await page.getByRole('button', { name: p.newPortfolio, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: messages.portfolios.portfolioDialog.title });
  await dialog.getByLabel(messages.portfolios.portfolioDialog.name).fill('Fundo de Emergência');
  await dialog.getByRole('button', { name: messages.portfolios.portfolioDialog.create }).click();
  await expect(dialog).toBeHidden();
  const fund = nav.getByRole('link', { name: 'Fundo de Emergência', exact: true });
  await expect(fund).toBeVisible();

  // Rename it.
  await fund.click();
  await expect(fund).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/portfolios\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: p.editPortfolio }).click();
  const edit = page.getByRole('dialog', { name: messages.portfolios.portfolioDialog.editTitle });
  await edit.getByLabel(messages.portfolios.portfolioDialog.name).fill('Obras');
  await edit.getByRole('button', { name: messages.portfolios.portfolioDialog.save }).click();
  await expect(edit).toBeHidden();
  await expect(nav.getByRole('link', { name: 'Obras', exact: true })).toBeVisible();
  await expect(fund).toHaveCount(0);

  // Delete it (an empty portfolio).
  await page.getByRole('button', { name: p.editPortfolio }).click();
  const again = page.getByRole('dialog', { name: messages.portfolios.portfolioDialog.editTitle });
  await again.getByRole('button', { name: messages.portfolios.portfolioDialog.delete }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: messages.portfolios.portfolioDialog.deleteConfirm })
    .click();
  await expect(nav.getByRole('link', { name: 'Obras', exact: true })).toHaveCount(0);
  await expect(xtb).toBeVisible();
});

test('the mobile menu has the same portfolios', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page);
  await seedXtb(page);
  await page.goto(`/${world.poolId}/portfolios`);
  await page.getByRole('button', { name: messages.shell.openMenu }).click();
  await expect(
    page.getByRole('navigation', { name: NAV }).getByRole('link', { name: 'XTB', exact: true }),
  ).toBeVisible();
});
