import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

import { MEMBERS_PASSWORD, seedMembersWorld, type MembersWorld } from './support/members';
import { fillAndSubmit } from './support/sign-in';
import { E2E_ORIGIN } from './support/user';

// The statement import screen (NES-64) against the real parser service (`pnpm parser:up`) with
// generated fixtures: no real statement is stored (tests/e2e/fixtures/imports, made by
// services/parser/scripts/export_e2e_fixtures.py).
//
// Each format is one entry of FORMATS: a new parser adds its entry plus its fixture.

const t = messages.imports;
const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/imports/${name}`, import.meta.url));

interface Format {
  name: string;
  file: string;
  /** The parser as the banner names it. */
  parser: string;
  kind: 'bank' | 'broker';
  /** The account number the file states, to check the account is pre-selected. */
  accountNo?: string;
}

const FORMATS: readonly Format[] = [
  {
    name: 'Trade Republic PDF',
    file: 'trade-republic.pdf',
    parser: t.parsers.tradeRepublicPdf,
    kind: 'bank',
  },
  {
    name: 'XTB xlsx',
    file: 'xtb.xlsx',
    parser: t.parsers.xtbXlsx,
    kind: 'broker',
    accountNo: '50000001',
  },
  {
    name: 'Banco Invest xlsx',
    file: 'banco-invest.xlsx',
    parser: t.parsers.bancoInvestXlsx,
    kind: 'broker',
  },
  {
    name: 'BPI xlsx',
    file: 'bpi.xlsx',
    parser: t.parsers.bpiXlsx,
    kind: 'bank',
  },
  {
    name: 'Investment transactions CSV',
    file: 'investment-transactions.csv',
    parser: t.parsers.investmentCsv,
    kind: 'broker',
  },
];

// Each test starts signed out and works in a pool of its own, so nothing depends on another spec.
test.use({ storageState: { cookies: [], origins: [] } });

let world: MembersWorld;
test.beforeEach(async () => {
  world = await seedMembersWorld();
});

async function signIn(page: Page, email: string, path = '/importar') {
  const url = `/${world.poolId}${path}`;
  await page.goto(`/login?next=${encodeURIComponent(url)}`);
  await fillAndSubmit(page, email, MEMBERS_PASSWORD);
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

/** An account the file can go to; a brokerage account also gets a portfolio to put its operations in. */
async function seedAccount(page: Page, format: Pick<Format, 'kind' | 'accountNo'>) {
  const { holders } = await api<{ holders: { id: string }[] }>(page, '/holders');
  const portfolio =
    format.kind === 'broker'
      ? await api<{ id: string }>(page, '/portfolios', {
          name: 'Carteira',
          color: '#9d6bff',
          currency: 'EUR',
        })
      : null;
  return api<{ id: string; name: string }>(page, '/accounts', {
    type: format.kind === 'broker' ? 'brokerage' : 'checking',
    name: format.kind === 'broker' ? 'Corretora Teste' : 'Conta Teste',
    currency: format.kind === 'broker' ? 'USD' : 'EUR',
    holderIds: [holders[0]?.id],
    ...(portfolio ? { portfolioId: portfolio.id } : {}),
    ...(format.accountNo ? { xtbAccountNo: format.accountNo } : {}),
  });
}

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

const dropFile = (page: Page, name: string) =>
  page.getByLabel(t.drop.inputLabel).setInputFiles(fixture(name));

const confirmButton = (page: Page) =>
  page.getByRole('button', { name: /^Importar \d+ movimentos?$/ });

for (const format of FORMATS) {
  test(`${format.name} is detected, previewed and imported; the same file again adds 0 new lines`, async ({
    page,
  }) => {
    await signIn(page, world.admin.email);
    const account = await seedAccount(page, format);
    await page.reload();
    await hydrated(page);

    await dropFile(page, format.file);
    await expect(
      page.getByText(
        t.detected.banner.replace('{parser}', format.parser).replace('{level}', t.confidence.high),
      ),
    ).toBeVisible();

    // The only account that fits (or the one the file names) is already chosen.
    const select = page.getByLabel(t.account.label);
    await expect(select).toHaveValue(account.id);
    await expect(confirmButton(page)).toBeEnabled();
    await expect(page.getByRole('table', { name: t.table.label })).toBeVisible();

    await confirmButton(page).click();
    await expect(page.getByText(t.done.title)).toBeVisible();
    // The history lists the file.
    await expect(
      page.getByRole('table', { name: t.history.title }).getByText(format.file),
    ).toBeVisible();

    // The same file again: everything is a duplicate, "0 novos" and the button is off.
    await page.getByRole('button', { name: t.actions.another }).click();
    await dropFile(page, format.file);
    await expect(page.getByLabel(t.account.label)).toHaveValue(account.id);
    await expect(page.getByText('0 novos', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Este ficheiro já foi importado em /)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Importar 0 movimentos$/ })).toBeDisabled();
  });
}

test('a csv no format recognises goes through the column mapping and is imported', async ({
  page,
}) => {
  await signIn(page, world.admin.email);
  const account = await seedAccount(page, { kind: 'bank' });
  await page.reload();
  await hydrated(page);

  await dropFile(page, 'generic-bank.csv');
  await expect(page.getByRole('heading', { name: t.mapping.title })).toHaveCount(0);
  await expect(page.getByText(t.mapping.text)).toBeVisible();
  await expect(page.getByLabel(t.mapping.date, { exact: true })).toHaveValue('Data');
  await expect(page.getByLabel(t.mapping.amount, { exact: true })).toHaveValue('Valor');

  await page.getByRole('button', { name: t.mapping.confirm }).click();
  await expect(page.getByLabel(t.account.label)).toHaveValue(account.id);
  await expect(page.getByText('Café Central')).toBeVisible();
  await confirmButton(page).click();
  await expect(page.getByText(t.done.title)).toBeVisible();
});

test('a file of the wrong type is refused before it is uploaded', async ({ page }) => {
  await signIn(page, world.admin.email);
  await hydrated(page);
  await page.getByLabel(t.drop.inputLabel).setInputFiles({
    name: 'virus.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('MZ'),
  });
  await expect(page.getByRole('alert').filter({ hasText: t.errors.unsupported })).toBeVisible();
});

test('a member imports; a viewer has no access to the screen or the API', async ({ page }) => {
  await signIn(page, world.member.email);
  await expect(page.getByRole('heading', { name: t.title })).toBeVisible();
  await expect(page.getByLabel(t.drop.inputLabel)).toBeAttached();
  await page.context().clearCookies();

  await signIn(page, world.viewer.email);
  await expect(page.getByText(t.noAccess.title)).toBeVisible();
  await expect(page.getByLabel(t.drop.inputLabel)).toHaveCount(0);

  const history = await page.request.get(`/api/v1/pools/${world.poolId}/imports`);
  expect(history.status()).toBe(403);
  const upload = await page.request.post(`/api/v1/pools/${world.poolId}/imports`, {
    headers: { Origin: E2E_ORIGIN },
    multipart: { file: { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('a;b\n') } },
  });
  expect(upload.status()).toBe(403);
});

test('the import buttons on Contas e poupanças show only to people who may import', async ({
  page,
}) => {
  const a = messages.accounts;
  await signIn(page, world.member.email, '/contas');
  await expect(page.getByRole('button', { name: a.importStatement })).toBeVisible();
  await expect(page.getByRole('button', { name: a.importInvestments })).toBeVisible();
  await page.context().clearCookies();
  await signIn(page, world.viewer.email, '/contas');
  await expect(page.getByRole('heading', { name: messages.nav.items.accounts })).toBeVisible();
  await expect(page.getByRole('button', { name: a.importStatement })).toHaveCount(0);
  await expect(page.getByRole('button', { name: a.importInvestments })).toHaveCount(0);
});

test('the bank statement modal (22) imports a file from Contas e poupanças', async ({ page }) => {
  await signIn(page, world.admin.email, '/contas');
  const account = await seedAccount(page, { kind: 'bank' });
  await page.reload();
  await hydrated(page);

  await page.getByRole('button', { name: messages.accounts.importStatement }).click();
  const modal = page.getByRole('dialog', { name: t.dialog.bankTitle });
  await modal.getByLabel(t.drop.inputLabel).setInputFiles(fixture('trade-republic.pdf'));
  await expect(modal.getByLabel(t.account.label)).toHaveValue(account.id);
  await modal.getByRole('button', { name: /^Importar \d+ movimentos?$/ }).click();
  await expect(modal.getByText(t.done.title)).toBeVisible();
  await modal.getByRole('button', { name: t.dialog.close, exact: true }).first().click();
  await expect(modal).toBeHidden();
});

test('the investment transactions modal (21) opens from Contas e poupanças', async ({ page }) => {
  await signIn(page, world.admin.email, '/contas');
  await hydrated(page);
  await page.getByRole('button', { name: messages.accounts.importInvestments }).click();
  const modal = page.getByRole('dialog', { name: t.dialog.brokerTitle });
  await expect(modal.getByLabel(t.drop.inputLabel)).toBeAttached();
  await expect(modal.getByRole('link', { name: t.dialog.fullScreen })).toBeVisible();
});
