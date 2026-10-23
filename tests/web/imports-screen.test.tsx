import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@nestvault/ui';
import { HistoryBlock } from '@webapp/components/imports/history-block';
import { PreviewStep } from '@webapp/components/imports/preview-step';
import type { AccountCard } from '@webapp/lib/accounts-types';
import type { ImportPreview } from '@webapp/lib/imports-types';

import messages from '../../apps/web/messages/pt-PT.json';
import { NextIntlClientProvider } from '../../apps/web/node_modules/next-intl';

vi.mock('../../apps/web/node_modules/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-PT" messages={messages} timeZone="Europe/Lisbon">
      <ToastProvider>{node}</ToastProvider>
    </NextIntlClientProvider>,
  );

const ACCOUNT_ID = '0192f3a1-0000-7000-8000-000000000001';
const accounts = [
  { id: ACCOUNT_ID, type: 'checking', name: 'Conta à ordem', currency: 'EUR', subAccounts: [] },
] as unknown as AccountCard[];

const preview = (over: Partial<ImportPreview> = {}): ImportPreview => ({
  status: 'preview',
  batchId: '0192f3a1-0000-7000-8000-0000000000b1',
  kind: 'bank',
  fileName: 'extrato.csv',
  parser: { parserId: 'trade-republic-pdf', kind: 'bank', version: '1', confidence: 0.93 },
  remembered: false,
  accountId: ACCOUNT_ID,
  accountHint: null,
  reconciled: true,
  openingBalance: '0',
  closingBalance: '5285.98',
  warnings: [],
  duplicateFile: null,
  summary: { total: 2, new: 2, duplicates: 0, skipped: 0 },
  rows: [
    {
      index: 0,
      kind: 'bank',
      date: '2026-03-02',
      description: 'Café Central',
      amount: '-1.20',
      balance: null,
      duplicate: false,
      categoryId: null,
      transfer: false,
      transferPair: false,
      valid: true,
    },
    {
      index: 1,
      kind: 'bank',
      date: '2026-03-05',
      description: 'Salário',
      amount: '1500.00',
      balance: null,
      duplicate: false,
      categoryId: null,
      transfer: false,
      transferPair: false,
      valid: true,
    },
  ],
  rowsTruncated: false,
  broker: null,
  ...over,
});

const step = (data: ImportPreview, accountId = ACCOUNT_ID) =>
  wrap(
    <PreviewStep
      preview={data}
      accounts={accounts}
      portfolios={[]}
      categories={[]}
      accountId={accountId}
      busy={false}
      onAccount={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

const confirmButton = (html: string) =>
  /<button[^>]*>(Importar \d+ movimentos?)<\/button>/.exec(html);
const disabledConfirm = (html: string) =>
  /<button[^>]*disabled=""[^>]*>Importar \d+ movimentos?<\/button>/.test(html);

describe('PreviewStep', () => {
  it('shows the detected format with its confidence, the figures and the first lines', () => {
    const html = step(preview());
    expect(html).toContain('Formato detetado: Trade Republic (PDF) · confiança alta');
    expect(html).toContain('Café Central');
    expect(html).toContain('02/03/2026');
    expect(html).toContain('02/03/2026 a 05/03/2026');
    expect(html).toContain('Confere com o saldo');
    expect(confirmButton(html)?.[1]).toBe('Importar 2 movimentos');
    expect(disabledConfirm(html)).toBe(false);
  });

  it('shows 0 novos and disables the confirm button when every line is a duplicate', () => {
    const html = step(
      preview({
        summary: { total: 2, new: 0, duplicates: 2, skipped: 0 },
        rows: preview().rows.map((row) => ({ ...row, duplicate: true })),
      }),
    );
    expect(html).toContain('0 novos');
    expect(html).toContain('Todos os movimentos já existem nesta conta: 0 novos.');
    expect(disabledConfirm(html)).toBe(true);
  });

  it('keeps the confirm button off until an account is chosen', () => {
    const html = step(
      preview({ accountId: null, summary: { total: 2, new: 2, duplicates: null, skipped: 0 } }),
      '',
    );
    expect(html).toContain('Escolhe a conta para ver os movimentos novos.');
    expect(disabledConfirm(html)).toBe(true);
  });

  it('warns when the same file was imported before', () => {
    const html = step(preview({ duplicateFile: { committedAt: '2026-02-10T09:00:00.000Z' } }));
    expect(html).toContain('Este ficheiro já foi importado em 10/02/2026');
  });

  it('escapes what the file says', () => {
    const hostile = preview();
    hostile.rows = [
      { ...hostile.rows[0], description: '<img src=x onerror=alert(1)>' },
    ] as ImportPreview['rows'];
    const html = step(hostile);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('offers the opening balance adjustment only when the file has a closing balance', () => {
    expect(step(preview())).toContain('Acertar o saldo inicial da conta pelo extrato');
    expect(step(preview({ closingBalance: null }))).not.toContain('Acertar o saldo inicial');
  });
});

describe('HistoryBlock', () => {
  it('says so when nothing was imported yet', () => {
    expect(wrap(<HistoryBlock history={{ items: [] }} accountNames={new Map()} />)).toContain(
      'Ainda não foi importado nenhum ficheiro.',
    );
  });

  it('lists date, file, account, rows and format', () => {
    const html = wrap(
      <HistoryBlock
        history={{
          items: [
            {
              batchId: '0192f3a1-0000-7000-8000-0000000000b1',
              accountId: ACCOUNT_ID,
              fileName: 'extrato.pdf',
              rowCount: 12,
              inserted: 10,
              parserId: 'xtb-xlsx',
              committedAt: '2026-03-15T10:00:00.000Z',
            },
          ],
        }}
        accountNames={new Map([[ACCOUNT_ID, 'Conta à ordem']])}
      />,
    );
    expect(html).toContain('15/03/2026');
    expect(html).toContain('extrato.pdf');
    expect(html).toContain('Conta à ordem');
    expect(html).toContain('XTB (XLSX)');
  });
});
