import { describe, expect, it } from 'vitest';

import type { AccountCard } from '@webapp/lib/accounts-types';
import { importProblemKey } from '@webapp/lib/imports-api';
import type { ImportPreview } from '@webapp/lib/imports-types';
import {
  columnOf,
  commitBody,
  confidenceLevel,
  dateFormatOf,
  defaultAccount,
  eligibleAccounts,
  hasAcceptedExtension,
  matchAccountByHint,
  newAssetsFor,
  newCount,
  periodOf,
  uploadForm,
  withColumn,
  withDateFormat,
} from '@webapp/lib/imports-view';

const account = (over: Partial<AccountCard>): AccountCard =>
  ({
    id: '0192f3a1-0000-7000-8000-000000000001',
    type: 'checking',
    name: 'Conta',
    iban: null,
    xtbAccountNo: null,
    subAccounts: [],
    ...over,
  }) as AccountCard;

const checking = account({ id: 'c1', iban: 'PT50 0002 0123 1234 5678 9015 4' });
const other = account({ id: 'c2', name: 'Outra' });
const broker = account({ id: 'b1', type: 'brokerage', xtbAccountNo: '50611139' });

const brokerPreview = {
  kind: 'broker',
  accountId: null,
  accountHint: null,
  summary: { total: 2, new: 2, duplicates: null, skipped: 0 },
  broker: {
    symbols: [
      { symbol: 'AAPL.US', name: 'Apple', assetId: null },
      { symbol: 'VWCE.DE', name: null, assetId: '0192f3a1-0000-7000-8000-0000000000aa' },
    ],
    holders: [],
    portfolioId: null,
  },
  rows: [
    {
      index: 0,
      kind: 'broker',
      date: '2026-03-02',
      type: 'buy',
      symbol: 'AAPL.US',
      quantity: '1',
      price: '10',
      amount: '10',
      currency: 'USD',
      holder: null,
      duplicate: null,
      supported: true,
    },
  ],
} as unknown as ImportPreview;

describe('confidenceLevel', () => {
  it('names high, medium and low confidence', () => {
    expect(confidenceLevel(0.95)).toBe('high');
    expect(confidenceLevel(0.85)).toBe('high');
    expect(confidenceLevel(0.7)).toBe('medium');
    expect(confidenceLevel(0.3)).toBe('low');
  });
});

describe('hasAcceptedExtension', () => {
  it('accepts csv, xlsx, xlsm and pdf in any case, and nothing else', () => {
    for (const name of ['a.csv', 'a.XLSX', 'a.xlsm', 'a.Pdf']) {
      expect(hasAcceptedExtension(name)).toBe(true);
    }
    for (const name of ['a.exe', 'a.xls', 'csv', 'a.csv.exe']) {
      expect(hasAcceptedExtension(name)).toBe(false);
    }
  });
});

describe('accounts for a file', () => {
  it('sends bank files to cash accounts and broker files to brokerage accounts', () => {
    const all = [checking, other, broker];
    expect(eligibleAccounts(all, 'bank').map((a) => a.id)).toEqual(['c1', 'c2']);
    expect(eligibleAccounts(all, 'broker').map((a) => a.id)).toEqual(['b1']);
  });

  it('matches the number a file states with an IBAN or a broker account number', () => {
    expect(matchAccountByHint('PT50000201231234567890154', [checking, other])?.id).toBe('c1');
    expect(matchAccountByHint('50611139', [broker])?.id).toBe('b1');
    expect(matchAccountByHint('5061', [broker])).toBeNull();
    expect(matchAccountByHint(null, [checking])).toBeNull();
    expect(
      matchAccountByHint('PT50000201231234567890154', [checking, { ...checking, id: 'c3' }]),
    ).toBeNull();
  });

  it('starts with the account the file names, else the only one that fits, else none', () => {
    const kind = { accountId: null, accountHint: null, kind: 'bank' } as const;
    expect(defaultAccount({ ...kind, accountHint: '50611139', kind: 'broker' }, [broker])).toBe(
      'b1',
    );
    expect(defaultAccount(kind, [checking, broker])).toBe('c1');
    expect(defaultAccount(kind, [checking, other])).toBe('');
    expect(defaultAccount({ ...kind, accountId: 'c2' }, [checking, other])).toBe('c2');
  });
});

describe('uploadForm', () => {
  const file = new File(['x'], 'a.csv');

  it('sends the file and only the fields given', () => {
    const form = uploadForm(file, { accountId: 'c1' });
    expect(form.get('file')).toBeInstanceOf(File);
    expect(form.get('accountId')).toBe('c1');
    expect(form.has('parserId')).toBe(false);
    expect(form.has('spec')).toBe(false);
  });

  it('never sends a parser and a spec together', () => {
    const form = uploadForm(file, { parserId: 'xtb-xlsx', spec: { id: 'x' } });
    expect(form.get('parserId')).toBe('xtb-xlsx');
    expect(form.has('spec')).toBe(false);
    expect(uploadForm(file, { spec: { id: 'x' } }).get('spec')).toBe('{"id":"x"}');
  });
});

describe('broker commit', () => {
  it('creates an asset for each symbol the pool lacks, with the ticker without the exchange suffix', () => {
    expect(newAssetsFor(brokerPreview, { 'AAPL.US': 'etf' })).toEqual([
      { symbol: 'AAPL.US', ticker: 'AAPL', name: 'Apple', type: 'etf', currency: 'USD' },
    ]);
  });

  it('builds a body of chosen fields only, with no pool or status', () => {
    const body = commitBody(brokerPreview, {
      accountId: 'b1',
      adjustOpeningBalance: true,
      portfolioId: 'p1',
      assetTypes: {},
      subAccounts: { Rui: 's1', Ana: '' },
    });
    expect(body).toEqual({
      accountId: 'b1',
      portfolioId: 'p1',
      newAssets: [
        { symbol: 'AAPL.US', ticker: 'AAPL', name: 'Apple', type: 'stock', currency: 'USD' },
      ],
      subAccounts: { Rui: 's1', Ana: null },
    });
  });

  it('sends only the account and the opening-balance choice for a bank file', () => {
    const bank = { ...brokerPreview, kind: 'bank' } as ImportPreview;
    expect(
      commitBody(bank, {
        accountId: 'c1',
        adjustOpeningBalance: true,
        portfolioId: '',
        assetTypes: {},
        subAccounts: {},
      }),
    ).toEqual({ accountId: 'c1', adjustOpeningBalance: true });
  });
});

describe('preview figures', () => {
  it('has no new lines until an account is chosen, then the count the server worked out', () => {
    expect(newCount(brokerPreview)).toBe(0);
    expect(newCount({ ...brokerPreview, accountId: 'b1' })).toBe(2);
    expect(
      newCount({
        ...brokerPreview,
        accountId: 'b1',
        summary: { total: 2, new: 0, duplicates: 2, skipped: 0 },
      }),
    ).toBe(0);
  });

  it('reads the period from the first and last date', () => {
    const rows = [{ date: '2026-03-05' }, { date: '2026-01-02' }, { date: '2026-02-01' }];
    expect(periodOf({ rows } as unknown as ImportPreview)).toEqual(['2026-01-02', '2026-03-05']);
    expect(periodOf({ rows: [] })).toBeNull();
  });
});

describe('column mapping', () => {
  const spec = {
    id: 'g',
    columns: { date: 'Data', description: 'Descrição', debit: 'Débito', credit: 'Crédito' },
    formats: { date: 'dd-mm-yyyy', decimal: ',' },
  };

  it('points a column at another header without touching the rest', () => {
    const changed = withColumn(spec, 'description', 'Texto');
    expect(columnOf(changed, 'description')).toBe('Texto');
    expect(columnOf(changed, 'date')).toBe('Data');
    expect(columnOf(spec, 'description')).toBe('Descrição');
  });

  it('replaces the debit and credit pair when one amount column is chosen, and clears an optional one', () => {
    const changed = withColumn(spec, 'amount', 'Valor');
    expect(changed.columns).toEqual({ date: 'Data', description: 'Descrição', amount: 'Valor' });
    expect(withColumn(changed, 'amount', 'Valor').columns).toEqual(changed.columns);
    expect(
      columnOf(withColumn(withColumn(spec, 'balance', 'Saldo'), 'balance', ''), 'balance'),
    ).toBe('');
  });

  it('changes the date format and keeps the other formats', () => {
    const changed = withDateFormat(spec, 'yyyy-mm-dd');
    expect(dateFormatOf(changed)).toBe('yyyy-mm-dd');
    expect(changed.formats).toMatchObject({ decimal: ',' });
  });
});

describe('importProblemKey', () => {
  it.each([
    [0, 'network'],
    [400, 'invalid'],
    [403, 'forbidden'],
    [409, 'settled'],
    [413, 'tooLarge'],
    [415, 'unsupported'],
    [422, 'unrecognized'],
    [429, 'rateLimited'],
    [502, 'generic'],
  ])('maps %s to %s', (status, key) => {
    expect(importProblemKey({ status, code: null, issuePaths: [], retryAfterSeconds: 0 })).toBe(
      key,
    );
  });
});
