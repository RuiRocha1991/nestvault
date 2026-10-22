import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { MEMBERS_PASSWORD, seedMembersWorld } from './support/members';
import { fillAndSubmit } from './support/sign-in';
import { E2E_ORIGIN } from './support/user';

// The anonymized prototype export: no private data. Pixel baselines would break as the months on
// the charts move with the date, so these checks are structural: the layout of the summary of the
// prototype (hero, chart, allocation, accounts, positions, forecast) in both themes and on a phone,
// the design tokens it paints with, and a screenshot attached to the report for the eye.
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/prototype-export.anonymized.json', import.meta.url), 'utf8'),
) as unknown;

const s = messages.portfolios.summary;

// Each test starts signed out and works in a pool of its own, so nothing depends on another spec.
test.use({ storageState: { cookies: [], origins: [] } });

const BACKGROUND = { dark: 'rgb(26, 27, 56)', light: 'rgb(236, 236, 246)' } as const;

async function openSummary(page: Page, theme: 'dark' | 'light') {
  const world = await seedMembersWorld();
  await page.goto(`/login?next=${encodeURIComponent(`/${world.poolId}`)}`);
  await fillAndSubmit(page, world.owner.email, MEMBERS_PASSWORD);
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  const imported = await page.request.post(`/api/v1/pools/${world.poolId}/import-prototype`, {
    headers: { Origin: E2E_ORIGIN },
    data: { dryRun: false, export: fixture },
  });
  expect(imported.status()).toBe(200);
  const { portfolios } = (await (
    await page.request.get(`/api/v1/pools/${world.poolId}/portfolios`)
  ).json()) as { portfolios: { id: string; name: string }[] };
  const portfolio = portfolios.find((p) => p.name === 'Longo prazo');
  expect(portfolio).toBeDefined();
  await page.context().addCookies([{ name: 'nv-theme', value: theme, url: E2E_ORIGIN }]);
  await page.goto(`/${world.poolId}/portfolios/${portfolio?.id}`);
  await expect(page.getByRole('heading', { name: 'Longo prazo', level: 1 })).toBeVisible();
}

for (const theme of ['dark', 'light'] as const) {
  for (const [device, width, height] of [
    ['desktop', 1440, 900],
    ['phone', 390, 844],
  ] as const) {
    test(`the portfolio summary keeps the prototype layout: ${theme}, ${device}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height });
      await openSummary(page, theme);

      // The page paints with the theme's background token and never scrolls sideways.
      await expect(page.locator('body')).toHaveCSS('background-color', BACKGROUND[theme]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);

      // The tab bar has no stray scrollbar: the active underline (-mb-px) must not overflow it.
      const tabs = page.getByRole('navigation', { name: messages.portfolios.tabsLabel });
      const sizes = await tabs.evaluate((el) => ({
        scroll: el.scrollHeight,
        client: el.clientHeight,
      }));
      expect(sizes.scroll).toBe(sizes.client);

      // Header: title, search, "+ Transação" and the household's people.
      await expect(page.getByRole('search')).toBeVisible();
      await expect(
        page.getByRole('group', { name: messages.overview.header.holders }),
      ).toBeVisible();

      // The selected portfolio chip: colour square, name and value, outlined with the accent.
      const chip = page.getByRole('link', { name: /Longo prazo/ }).first();
      await expect(chip).toBeVisible();

      // Hero: the six figures of the prototype, with the cash as its own column.
      for (const label of [s.value, s.totalGain, s.irr, s.passiveIncome, s.positionsCost, s.cash]) {
        await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
      }
      await expect(page.getByText(s.capitalGain, { exact: true })).toBeVisible();

      // Chart, allocation, top positions and the 12 forecast bars.
      await expect(page.getByRole('img', { name: s.performance.title })).toBeVisible();
      await expect(page.getByRole('img', { name: s.allocation.title })).toBeVisible();
      await expect(page.getByRole('heading', { name: s.top.title })).toBeVisible();
      await expect(page.getByRole('img', { name: s.forecast.title })).toBeVisible();

      await testInfo.attach(`summary-${theme}-${device}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    });
  }
}

test('the two cards of a row stack on a phone instead of sharing the width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSummary(page, 'dark');
  const chart = await page.getByRole('heading', { name: s.performance.title }).boundingBox();
  const allocation = await page.getByRole('heading', { name: s.allocation.title }).boundingBox();
  expect(chart && allocation && allocation.y > chart.y + chart.height).toBe(true);
});
