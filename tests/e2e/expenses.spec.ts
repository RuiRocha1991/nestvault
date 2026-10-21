import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import {
  MEMBERS_PASSWORD,
  seedMembersWorld,
  type MembersPerson,
  type MembersWorld,
} from './support/members';
import { fillAndSubmit } from './support/sign-in';
import { E2E_ORIGIN } from './support/user';

const e = messages.expenses;
const MARCH = '2026-03';

// Each test starts signed out and works in a pool of its own, so nothing depends on another spec.
test.use({ storageState: { cookies: [], origins: [] } });

let world: MembersWorld;
test.beforeEach(async () => {
  world = await seedMembersWorld();
});

/** Waits until clicks work: React hydrated a button and the Next router is published. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('main button, main select, button');
    const router = (window as unknown as { next?: { router?: unknown } }).next?.router;
    return (
      !!button && !!router && Object.keys(button).some((key) => key.startsWith('__reactProps$'))
    );
  });
}

async function signIn(page: Page, person: MembersPerson, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await fillAndSubmit(page, person.email, MEMBERS_PASSWORD);
  await expect(page).toHaveURL(new RegExp(next.split('?')[0] ?? ''));
}

const base = () => `/api/v1/pools/${world.poolId}`;

async function send(page: Page, method: 'post' | 'get', path: string, data?: unknown) {
  const response = await page.request[method](`${base()}${path}`, {
    headers: { Origin: E2E_ORIGIN },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), `${method} ${path}`).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

/** An account and a few movements of March 2026, made through the API as the signed-in person. */
async function seedMarch(page: Page) {
  const { holders } = (await send(page, 'get', '/holders')) as { holders: { id: string }[] };
  const account = (await send(page, 'post', '/accounts', {
    type: 'checking',
    name: 'Conta BPI',
    currency: 'EUR',
    holderIds: [holders[0]?.id],
  })) as { id: string };
  const { categories } = (await send(page, 'get', '/categories')) as {
    categories: { id: string; systemKey: string | null }[];
  };
  const id = (key: string) => categories.find((category) => category.systemKey === key)?.id;
  const movement = (date: string, description: string, amount: string, categoryId?: string) =>
    send(page, 'post', '/transactions', {
      accountId: account.id,
      date,
      description,
      amount,
      ...(categoryId ? { categoryId } : {}),
    });
  await movement(`${MARCH}-05`, 'SALARIO EMPRESA', '2000', id('salary'));
  await movement(`${MARCH}-06`, 'COMPRA CONTINENTE', '-60', id('groceries'));
  await movement(`${MARCH}-07`, 'COMPRA LIDL', '-40');
  return { accountId: account.id, groceries: id('groceries') ?? '', dining: id('dining') ?? '' };
}

const despesas = (query: string) => `/${world.poolId}/despesas?${query}`;
const money = (text: string) => new RegExp(text.replace(' ', '\\s'));

test('the summary shows the month, its budget and the history; the month is in the URL', async ({
  page,
}) => {
  await signIn(page, world.admin, despesas('tab=resumo'));
  const { groceries } = await seedMarch(page);
  const settings = await page.request.patch(`${base()}/categories/${groceries}/settings`, {
    headers: { Origin: E2E_ORIGIN },
    data: { monthlyBudget: '150' },
  });
  expect(settings.ok()).toBe(true);

  await page.goto(despesas(`tab=resumo&month=${MARCH}`));
  await hydrated(page);
  await expect(page.getByRole('heading', { name: 'Orçamento de março' })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: money('2 000,00') })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: /Supermercado/ })).toBeVisible();
  await expect(page.getByRole('img', { name: e.summary.byCategoryChart })).toBeVisible();
  await expect(page.getByRole('img', { name: e.summary.incomeVsExpensesChart })).toBeVisible();

  await page.getByLabel(e.summary.monthLabel, { exact: true }).selectOption('2026-02');
  await expect(page).toHaveURL(/month=2026-02/);
  await expect(page.getByRole('heading', { name: 'Orçamento de fevereiro' })).toBeVisible();
});

test('movements: filters live in the URL, a category change shows at once, notes and new movements', async ({
  page,
}) => {
  await signIn(page, world.admin, despesas('tab=movimentos'));
  const { dining } = await seedMarch(page);
  await page.goto(despesas(`tab=movimentos&month=${MARCH}`));
  await hydrated(page);

  const rows = page.getByTestId('movement-row');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('dl').getByText(e.movements.uncategorized)).toBeVisible();

  // A filter goes to the URL and survives a reload.
  await page.getByLabel(e.movements.search, { exact: true }).fill('LIDL');
  await expect(page).toHaveURL(/q=LIDL/);
  await expect(rows).toHaveCount(1);
  await page.reload();
  await hydrated(page);
  await expect(page.getByLabel(e.movements.search, { exact: true })).toHaveValue('LIDL');
  await expect(rows).toHaveCount(1);

  // The category changes in the row and the totals move without waiting for a reload.
  const categorySelect = rows.first().getByRole('combobox');
  await categorySelect.selectOption(dining);
  await expect(categorySelect).toHaveValue(dining);
  await expect(page.getByTestId('movement-row').first()).toContainText('COMPRA LIDL');

  // `N` on a focused row opens its note.
  await rows.first().focus();
  await page.keyboard.press('n');
  const note = page.getByRole('dialog', { name: messages.notes.title });
  await note.getByLabel(messages.notes.label).fill('Jantar de anos');
  await note.getByRole('button', { name: messages.notes.save }).click();
  await expect(note).toBeHidden();
  await expect(rows.first().getByRole('button', { name: /Nota de COMPRA LIDL/ })).toBeVisible();

  // "Só com notas" is a filter too.
  await page.getByLabel(e.movements.search, { exact: true }).fill('');
  await page.getByLabel(e.movements.withNotes).check();
  await expect(page).toHaveURL(/notes=1/);
  await expect(rows).toHaveCount(1);
  await page.getByLabel(e.movements.withNotes).uncheck();

  // A manual movement.
  await page.getByRole('button', { name: e.newMovement, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: e.newMovementDialog.title });
  await dialog.getByLabel(e.newMovementDialog.date).fill(`${MARCH}-10`);
  await dialog.getByLabel(e.newMovementDialog.description).fill('PADARIA CENTRAL');
  await dialog.getByLabel(new RegExp(e.newMovementDialog.amount)).fill('3,50');
  await dialog.getByRole('button', { name: e.newMovementDialog.submit }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('PADARIA CENTRAL')).toBeVisible();
});

test('categories and rules: add a rule, reorder it, preview and apply the rules', async ({
  page,
}) => {
  await signIn(page, world.admin, despesas('tab=categorias'));
  const { groceries } = await seedMarch(page);
  await send(page, 'post', '/rules', { keyword: 'CONTINENTE', categoryId: groceries });
  await page.goto(despesas('tab=categorias'));
  await hydrated(page);

  await page.getByRole('button', { name: e.rules.add, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: e.rules.newTitle });
  await dialog.getByLabel(e.rules.keyword).fill('LIDL');
  await dialog.getByLabel(e.rules.categoryField).selectOption(groceries);
  await dialog.getByRole('button', { name: e.rules.submit }).click();
  await expect(dialog).toBeHidden();

  const rules = page.getByTestId('rule-row');
  await expect(rules).toHaveCount(2);
  await expect(rules.nth(1)).toContainText('LIDL');
  await rules
    .nth(1)
    .getByRole('button', { name: /Subir a regra LIDL/ })
    .click();
  await expect(rules.first()).toContainText('LIDL');
  // The order is the server's: it is still there after a reload.
  await page.reload();
  await hydrated(page);
  await expect(page.getByTestId('rule-row').first()).toContainText('LIDL');

  await page.getByRole('button', { name: e.rules.reapply }).click();
  const apply = page.getByRole('dialog', { name: e.rules.applyTitle });
  await expect(apply.getByText(/1 de 1 movimentos mudam/)).toBeVisible();
  await apply.getByRole('button', { name: /Aplicar 1 alterações/ }).click();
  await expect(apply).toBeHidden();
});

test('a viewer reads everything and has no write controls', async ({ page }) => {
  await signIn(page, world.owner, despesas('tab=resumo'));
  await seedMarch(page);
  await page.context().clearCookies();
  await signIn(page, world.viewer, despesas(`tab=movimentos&month=${MARCH}`));
  await hydrated(page);
  await expect(page.getByTestId('movement-row')).toHaveCount(3);
  await expect(page.getByRole('button', { name: e.newMovement, exact: true })).toHaveCount(0);
  await expect(page.getByTestId('movement-row').first().getByRole('combobox')).toBeDisabled();

  await page.goto(despesas('tab=categorias'));
  await expect(page.getByRole('button', { name: e.rules.add, exact: true })).toHaveCount(0);
});
