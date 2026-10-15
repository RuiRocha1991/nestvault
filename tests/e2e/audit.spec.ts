import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { AUDIT_PASSWORD, HOSTILE_NAME, seedAuditWorld, type AuditWorld } from './support/audit';
import { fillAndSubmit } from './support/sign-in';

const audit = messages.audit;
const tabs = messages.settings.tabs;

// Each test starts signed out and reads a pool of its own, so nothing depends on another spec.
test.use({ storageState: { cookies: [], origins: [] } });

let world: AuditWorld;
test.beforeAll(async () => {
  world = await seedAuditWorld();
});

const auditUrl = (query = '') => `/${world.poolId}/definicoes/auditoria${query}`;
const rows = (page: Page) => page.locator('tbody tr');

async function signInAs(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await fillAndSubmit(page, email, AUDIT_PASSWORD);
  await expect(page).toHaveURL(new RegExp(next.split('?')[0] ?? ''));
}

/**
 * Waits until clicks work: React marks a DOM node with `__reactProps$…` once it has hydrated it, and
 * the Next router publishes itself as `window.next.router` right after, which `router.push` needs.
 */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const select = document.querySelector('select');
    const router = (window as unknown as { next?: { router?: unknown } }).next?.router;
    return (
      !!select && !!router && Object.keys(select).some((key) => key.startsWith('__reactProps$'))
    );
  });
}

/**
 * Runs an interaction that changes the URL and retries it until the URL changes. Next cancels the
 * navigation of a click that lands while the page's link prefetches are still in flight (it only
 * happens in the first moments after a load, long before a person could click), so the first try
 * can be dropped without anything being wrong with the screen.
 */
async function navigates(page: Page, action: () => Promise<unknown>, url: RegExp) {
  await expect(async () => {
    await action();
    await expect(page).toHaveURL(url, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** Signs in, opens the audit screen and waits until its filters respond to clicks. */
async function openAudit(page: Page, email: string, query = '') {
  await signInAs(page, email, auditUrl(query));
  await hydrated(page);
}

test('the owner sees the Auditoria tab and a paginated list, newest first', async ({ page }) => {
  await openAudit(page, world.owner.email);

  await expect(
    page.getByRole('heading', { level: 1, name: messages.settings.title }),
  ).toBeVisible();
  const nav = page.getByRole('navigation', { name: messages.settings.tabsLabel });
  for (const label of Object.values(tabs)) await expect(nav.getByText(label)).toBeVisible();
  await expect(nav.getByRole('link', { name: tabs.audit })).toHaveAttribute('aria-current', 'page');

  await expect(rows(page)).toHaveCount(25);
  await expect(page.getByText(`1-25 de ${String(world.recentCount)}`)).toBeVisible();
  await expect(page.getByText(audit.pagination.previous, { exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  await navigates(
    page,
    () => page.getByRole('link', { name: audit.pagination.next }).click(),
    /page=2/,
  );
  await expect(rows(page)).toHaveCount(world.recentCount - 25);
  await expect(
    page.getByText(`26-${String(world.recentCount)} de ${String(world.recentCount)}`),
  ).toBeVisible();
  await expect(page.getByText(audit.pagination.next, { exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('filtering by Membros updates the list and the URL, and survives a reload', async ({
  page,
}) => {
  await openAudit(page, world.owner.email);

  await navigates(
    page,
    () => page.getByLabel(audit.filters.action, { exact: true }).selectOption('member'),
    /action=member/,
  );
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByText(audit.categories.member, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('member.role_changed')).toBeVisible();
  await expect(page.getByText('member.removed')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(audit.filters.action, { exact: true })).toHaveValue('member');
  await expect(rows(page)).toHaveCount(2);
});

test('the period presets and the person filter narrow the list', async ({ page }) => {
  await openAudit(page, world.owner.email);
  await expect(rows(page)).toHaveCount(25); // 30 days: the two 60 day old entries are out

  await navigates(
    page,
    () => page.getByRole('button', { name: audit.filters.rangeAll }).click(),
    /range=all/,
  );
  await expect(
    page.getByText(`1-25 de ${String(world.recentCount + world.oldCount)}`),
  ).toBeVisible();

  await navigates(
    page,
    () => page.getByLabel(audit.filters.person, { exact: true }).selectOption({ label: 'Liliana' }),
    /person=/,
  );
  await expect(rows(page)).toHaveCount(1); // the member only appears as actor of the old accept
  await expect(page.getByText('invite.accepted')).toBeVisible();
});

test('a custom period typed as dd/mm/aaaa is kept in the URL as an ISO date', async ({ page }) => {
  await openAudit(page, world.owner.email);
  const from = page.getByLabel(audit.filters.from, { exact: true });
  await navigates(
    page,
    async () => {
      await from.fill('01/01/2020');
      await from.press('Enter');
    },
    /from=2020-01-01/,
  );
  await expect(
    page.getByText(`1-25 de ${String(world.recentCount + world.oldCount)}`),
  ).toBeVisible();

  await from.fill('31/02/2020');
  await from.press('Enter');
  await expect(from).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/from=2020-01-01/);
});

test('an entry opens a detail panel with only its allowed data; Esc closes it', async ({
  page,
}) => {
  await openAudit(page, world.owner.email, '?action=member.role_changed');

  await rows(page).first().click();
  const panel = page.getByRole('complementary', { name: audit.detail.title });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole('heading', { name: audit.actions.member.roleChanged }),
  ).toBeFocused();
  await expect(panel.getByText('member.role_changed')).toBeVisible();
  await expect(panel.locator('pre')).toContainText('função anterior: Membro');
  await expect(panel.locator('pre')).toContainText('função: Administrador');
  await expect(panel.getByText(audit.detail.note)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(rows(page).first().getByRole('button')).toBeFocused();
});

test('no result gives the empty state, and "Limpar filtros" brings the list back', async ({
  page,
}) => {
  await openAudit(page, world.owner.email, '?action=auth.signin&range=7');

  await expect(page.getByText(audit.states.emptyTitle)).toBeVisible();
  await navigates(
    page,
    () => page.getByRole('button', { name: audit.filters.clear }).click(),
    /auditoria$/,
  );
  await expect(rows(page)).toHaveCount(25);
});

test('a hand-edited URL falls back to a sensible list instead of failing', async ({ page }) => {
  await signInAs(
    page,
    world.owner.email,
    auditUrl("?action=x'%20OR%201=1--&person=zzz&page=-4&from=nope"),
  );
  await expect(rows(page)).toHaveCount(25);
});

test('names are shown as text, never as markup', async ({ page }) => {
  await openAudit(page, world.owner.email, '?action=member.role_changed');
  await expect(page.locator('td', { hasText: HOSTILE_NAME })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
});

test('an admin and a member do not see the tab and get the 404 page on the URL', async ({
  page,
}) => {
  for (const person of [world.admin, world.member]) {
    await page.context().clearCookies();
    await signInAs(page, person.email, `/${world.poolId}`);
    await page.goto(`/${world.poolId}/definicoes`);
    const nav = page.getByRole('navigation', { name: messages.settings.tabsLabel });
    await expect(nav.getByText(tabs.params)).toBeVisible();
    await expect(nav.getByText(tabs.audit)).toHaveCount(0);

    const response = await page.goto(auditUrl());
    expect(response?.status()).toBe(404);
    await expect(page.getByText(audit.target.signinFailed)).toHaveCount(0);
  }
});

test('a person outside the pool gets the same 404', async ({ page }) => {
  const other = await seedAuditWorld();
  await signInAs(page, other.owner.email, `/${other.poolId}`);
  const response = await page.goto(auditUrl());
  expect(response?.status()).toBe(404);
});

test('on a phone the detail opens as a full-screen sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openAudit(page, world.owner.email, '?action=member.removed');
  await rows(page).first().click();
  const panel = page.getByRole('complementary', { name: audit.detail.title });
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(389);
  expect(box?.x).toBe(0);
  await page.getByRole('button', { name: audit.detail.close }).click();
  await expect(panel).toBeHidden();
});

for (const theme of ['dark', 'light'] as const) {
  test(`the screen renders in the ${theme} theme`, async ({ page, context }) => {
    await context.addCookies([{ name: 'nv-theme', value: theme, url: 'http://127.0.0.1:4010' }]);
    await openAudit(page, world.owner.email);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(rows(page)).toHaveCount(25);
  });
}
