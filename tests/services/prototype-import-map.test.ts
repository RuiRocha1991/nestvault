import { describe, expect, it } from 'vitest';

import { hashText, normalizeText, transactionHash } from '@nestvault/domain';
import {
  buildImportPlan,
  ImportPrototypeInput,
  jsonDepth,
  migrateLists,
  PrototypeExport,
  ValidationError,
  type ImportPlan,
} from '@nestvault/services';

import {
  FIXTURE_COUNTS,
  FIXTURE_WARNINGS,
  globalCategoryInfos,
  readFixture,
  readFixtureJson,
} from '../support/prototype-fixture';

// The pure part of the prototype import (NES-47): the export schema and the mapping to the rows
// the importer writes. No database; the service tests cover the guards and the transaction.

function counter() {
  let n = 0;
  return () =>
    `00000000-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`.replace(/^0{8}/, '0aaaaaaa');
}

const plan = (
  data: PrototypeExport = readFixture(),
  existingHolders: { id: string; name: string }[] = [],
): ImportPlan =>
  buildImportPlan({
    data,
    existingHolders,
    globalCategories: globalCategoryInfos(),
    newId: counter(),
  });

const warningsOf = (built: ImportPlan) =>
  Object.fromEntries(built.warnings.map((warning) => [warning.code, warning.count]));

/** The fixture with some of its lists replaced, for one-off cases. */
const withFixture = (patch: Record<string, unknown>) =>
  PrototypeExport.parse({ ...readFixtureJson(), ...patch });

describe('prototype export schema', () => {
  it('accepts the anonymized fixture', () => {
    expect(() => readFixture()).not.toThrow();
  });

  it('accepts what an empty prototype state looks like and what an old version lacks', () => {
    expect(PrototypeExport.safeParse({}).success).toBe(true);
    expect(PrototypeExport.safeParse({ v: 1, members: [], accounts: [], tx: [] }).success).toBe(
      true,
    );
  });

  it.each([
    ['an unknown top-level field', { surprise: 1 }],
    ['an unknown field in an account', { accounts: [{ id: 'a', extra: true }] }],
    ['an unknown field in a movement', { tx: [{ id: 't', pool_id: 'x' }] }],
    ['a list that is not a list', { tx: 'nope' }],
    ['a movement without an id', { tx: [{ desc: 'x' }] }],
    ['a version from the future', { v: 7 }],
    ['text where a number list belongs', { assets: [{ id: 'a', divMonths: 'x' }] }],
  ])('refuses %s', (_name, patch) => {
    expect(PrototypeExport.safeParse(patch).success).toBe(false);
  });

  it('keeps the request strict: no pool id, no unknown envelope field', () => {
    expect(ImportPrototypeInput.safeParse({ dryRun: true, export: {} }).success).toBe(true);
    expect(ImportPrototypeInput.safeParse({ dryRun: true, export: {}, poolId: 'x' }).success).toBe(
      false,
    );
    expect(ImportPrototypeInput.safeParse({ export: {} }).success).toBe(false);
    expect(ImportPrototypeInput.safeParse({ dryRun: 'yes', export: {} }).success).toBe(false);
  });

  it('measures how deep a JSON value goes without recursing', () => {
    expect(jsonDepth(1)).toBe(0);
    expect(jsonDepth({ a: [{ b: 1 }] })).toBe(3);
    let deep: unknown = 1;
    for (let i = 0; i < 100_000; i += 1) deep = [deep];
    expect(jsonDepth(deep)).toBeGreaterThan(64);
  });
});

describe('migrate rules of older versions', () => {
  it('leaves a version 6 file as it is', () => {
    const lists = migrateLists(readFixture());
    expect(lists.rulesAdded).toBe(0);
    expect(lists.rules).toHaveLength(8);
  });

  it('adds the default keyword rules an old file lacks, for categories it has', () => {
    const lists = migrateLists(
      PrototypeExport.parse({
        v: 2,
        categories: [{ id: 'c1', name: 'Supermercado', kind: 'expense', color: '#F2913D' }],
        rules: [{ id: 'r1', kw: 'lidl', cat: 'c1' }],
      }),
    );
    // Nine supermarket keywords, 'LIDL' already there; the file's own category list also gains the
    // categories versions 3 and 4 introduced (they have no keywords except the three below).
    const keywords = lists.rules.map((rule) => normalizeText(rule.kw));
    expect(keywords).toContain('CONTINENTE');
    expect(keywords.filter((keyword) => keyword === 'LIDL')).toHaveLength(1);
    expect(lists.categories.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Levantamentos (numerário)', 'Reembolsos', 'Desporto e ginásio']),
    );
    expect(lists.rulesAdded).toBeGreaterThan(10);
  });
});

describe('mapping the fixture', () => {
  it('creates the expected rows per entity', () => {
    expect(plan().counts).toEqual(FIXTURE_COUNTS);
  });

  it('reports what it dropped or changed, by code', () => {
    expect(warningsOf(plan())).toEqual(FIXTURE_WARNINGS);
  });

  it('gives every row a new id and never reuses a prototype id', () => {
    const built = plan();
    const ids = [
      ...built.newHolders,
      ...built.portfolios,
      ...built.accounts,
      ...built.accounts.flatMap((account) => account.subAccounts),
      ...built.products,
      ...built.deposits,
      ...built.assets,
      ...built.categories,
      ...built.rules,
      ...built.transactions,
      ...built.plans,
      ...built.ops,
      ...built.cashMoves,
      ...built.interest,
    ].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^0aaaaaaa-0000-7000-8000-\d{12}$/);
  });

  it('maps the default categories onto the global catalogue and the rest to own ones', () => {
    const built = plan();
    const globals = new Set(globalCategoryInfos().map((category) => category.id));
    expect(built.categories.map((category) => category.values)).toEqual([
      { name: 'Cantina', kind: 'expense', color: '#AA33BB' },
      { name: 'Mesada', kind: 'income', color: '#33AA55' },
    ]);
    // Budgets and a colour of the family's own become the pool's settings of that category.
    const budgets = built.categorySettings.map((setting) => [
      globals.has(setting.categoryId),
      setting.values.monthlyBudget,
      setting.values.colorOverride,
    ]);
    expect(budgets).toEqual([
      [true, '700', '#112233'],
      [true, '450', null],
      [true, '120', null],
      [false, '40', null],
    ]);
    const salary = globalCategoryInfos().find((category) => category.systemKey === 'salary');
    const wages = built.transactions.filter((tx) => tx.description === 'VENCIMENTO EMPRESA');
    expect(wages.map((tx) => tx.categoryId)).toEqual([salary?.id]);
  });

  it('keeps a category kind the family changed as an own category instead of the global one', () => {
    const data = withFixture({
      categories: [{ id: 'c12', name: 'Compras', kind: 'income', color: '#E5424D' }],
      rules: [],
      tx: [],
    });
    const built = plan(data);
    expect(built.categories.map((category) => category.values.name)).toEqual(['Compras']);
    expect(built.categories[0]?.values.kind).toBe('income');
  });

  it('recomputes the hash with SHA-256 over the new account id, counting identical lines', () => {
    const built = plan();
    const coffees = built.transactions.filter((tx) => tx.description === 'CAFE');
    expect(coffees).toHaveLength(2);
    const [first, second] = coffees;
    const base = {
      accountId: first?.accountId ?? '',
      date: '2026-01-15',
      description: 'CAFE',
      amount: '-1.2',
    };
    expect(first?.hash).toBe(transactionHash(base, 1));
    expect(second?.hash).toBe(transactionHash(base, 2));
    expect(first?.hash).toBe(hashText(`${base.accountId}2026-01-15CAFE-1.2#1`));
    expect(first?.hash).toMatch(/^[0-9a-f]{64}$/);
    // No old 32-bit hash survives.
    expect(built.transactions.some((tx) => tx.hash.startsWith('old-'))).toBe(false);
    expect(new Set(built.transactions.map((tx) => `${tx.accountId}|${tx.hash}`)).size).toBe(
      built.transactions.length,
    );
  });

  it('keeps transfer pairs both ways, manual categories, locks and deposit links', () => {
    const built = plan();
    const byDescription = (text: string) => {
      const found = built.transactions.find((tx) => tx.description === text);
      if (!found) throw new Error(`no ${text}`);
      return found;
    };
    const out = byDescription('TRF P/ POUPANCA');
    const into = byDescription('TRF DE CONTA ANA');
    expect(built.pairs).toContainEqual({ id: out.id, pairId: into.id });
    expect(built.pairs).toContainEqual({ id: into.id, pairId: out.id });
    expect(out.transfer && into.transfer).toBe(true);
    expect(byDescription('COMPRA GALP').manualCategory).toBe(true);
    expect(byDescription('APLICACAO DEPOSITO')).toMatchObject({
      transfer: true,
      transferLocked: true,
    });
    expect(byDescription('JURO DEPOSITO').depositInterest).toBe(true);
    // The pair that pointed at a movement not in the file is dropped, the transfer flag stays.
    expect(byDescription('TRF P/ OUTRA CONTA').transfer).toBe(true);
    expect(built.pairs.some((pair) => pair.id === byDescription('TRF P/ OUTRA CONTA').id)).toBe(
      false,
    );
  });

  it('stores text with SQL and HTML in it as the data it is', () => {
    const odd = plan().transactions.find((tx) => tx.description.startsWith("'); DROP TABLE"));
    expect(odd?.description).toBe("'); DROP TABLE accounts; -- <script>alert(1)</script>");
  });

  it('turns accounts into the new types with holders, sub-accounts and a deposit', () => {
    const built = plan();
    expect(built.accounts.map((account) => account.values.type)).toEqual([
      'checking',
      'checking',
      'savings',
      'term_deposit',
      'brokerage',
      'checking',
    ]);
    const [ana, , savings, deposit, broker, legacy] = built.accounts;
    expect(ana?.values.iban).toBe('PT50000201231234567890154');
    expect(built.accounts[1]?.values.iban).toBeNull();
    expect(savings?.values.rate).toBe('2');
    expect(savings?.holderIds).toHaveLength(2);
    expect(deposit?.values.rate).toBeNull();
    expect(broker?.subAccounts.map((sub) => sub.name)).toEqual(['Ana PPR', 'Filho PPR']);
    // The second sub-account is named after somebody who does not own the account: no holder.
    expect(broker?.subAccounts.map((sub) => sub.holderId === null)).toEqual([false, true]);
    expect(broker?.values.xtbAccountNo).toBe('12345678');
    expect(legacy?.holderIds).toHaveLength(1);
    expect(legacy?.values.portfolioId).toBe(built.portfolios[1]?.id);
    expect(built.deposits[0]).toMatchObject({
      accountId: deposit?.id,
      values: {
        capital: '10000',
        rate: '2.5',
        payN: 3,
        payU: 'm',
        termN: 12,
        termU: 'm',
        tax: '28',
        capitalize: false,
        productId: built.products[0]?.id,
        payToAccountId: savings?.id,
        fundFromAccountId: built.accounts[1]?.id,
      },
    });
  });

  it('maps assets, prices, targets, plans, operations, cash moves and interest', () => {
    const built = plan();
    expect(built.assets.map((asset) => [asset.values.ticker, asset.values.type])).toEqual([
      ['VWCE', 'etf'],
      ['AAPL', 'stock'],
      ['PPR-AC', 'ppr'],
      ['IBM-CORP-', 'stock'],
    ]);
    expect(built.assets[1]?.values).toMatchObject({
      dps: '1.04',
      divMonths: [2, 5, 8, 11],
      region: 'EUA',
    });
    expect(built.currentPrices.map((price) => [price.date, price.price])).toEqual([
      ['2026-03-01', '130'],
      ['2026-03-01', '200'],
      ['2026-03-01', '15.5'],
    ]);
    expect(built.historyPrices).toHaveLength(3);
    // Targets follow the assets' new ids; a target for an asset that is not in the file goes.
    expect(built.portfolios[0]?.values.targets).toEqual({
      [built.assets[0]?.id ?? '']: '75',
      [built.assets[2]?.id ?? '']: '25',
    });
    const buys = built.ops.filter((op) => op.type === 'buy');
    expect(buys).toHaveLength(7);
    expect(built.ops.find((op) => op.type === 'dividend')).toMatchObject({
      amount: '0.62',
      gross: '0.87',
      tax: '0.25',
      qty: null,
    });
    // The plan ran once a month: the second buy of January loses its link, the plan keeps its months.
    const planned = built.ops.filter((op) => op.planId !== null);
    expect(planned.map((op) => op.planPeriod)).toEqual(['2026-01', '2026-02']);
    // A cash account that cannot settle investments (a term deposit) is cleared.
    expect(built.ops.at(-1)?.accountId).toBeNull();
    expect(built.ops.find((op) => op.date === '2026-02-21')?.fee).toBeNull();
    expect(built.cashMoves.map((move) => [move.values.amount, move.values.mirror])).toEqual([
      ['-100', true],
      ['50', false],
    ]);
    expect(built.cashMoves[0]?.values.transactionId).toBe(
      built.transactions.find((tx) => tx.description.startsWith('Liquidez vinda'))?.id,
    );
    expect(built.interest.map((entry) => entry.values.amount)).toEqual(['8.5', '8.6']);
  });

  it('turns the prototype settings into the pool settings', () => {
    expect(plan().settings).toEqual({
      transferWindowDays: 3,
      depositTax: '28',
      dividendTax: '28',
      fxOverrides: { USD: '0.92', GBP: '1.17', CHF: '1.06' },
    });
  });

  it('reuses a person the pool already has instead of creating them again', () => {
    const built = plan(readFixture(), [{ id: 'existing-holder', name: ' ana ' }]);
    expect(built.counts.holders).toBe(2);
    expect(built.counts.holdersMatched).toBe(1);
    expect(built.newHolders.map((holder) => holder.name)).toEqual(['Rui', 'Filho']);
    expect(built.accounts[0]?.holderIds).toEqual(['existing-holder']);
    expect(warningsOf(built).holder_matched).toBe(1);
  });

  it('gives an account without a known owner the first person, and says so', () => {
    const built = plan(withFixture({ members: [{ id: 'm9', name: 'Outra' }] }));
    expect(built.accounts.every((account) => account.holderIds.length > 0)).toBe(true);
    expect(warningsOf(built).account_owner_defaulted).toBe(6);
  });

  it('stops with the paths of the values it cannot store', () => {
    const data = withFixture({
      accounts: [{ id: 'a1', name: 'X', type: 'ordem', ccy: 'JPY', members: ['m1'] }],
      assets: [{ id: 'as1', ticker: 'AAA', ccy: 'BRL' }],
      portfolios: [{ id: 'p1', name: 'P', ccy: 'ZZZ' }],
    });
    try {
      plan(data);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues.map((issue) => issue.path)).toEqual([
        'export.portfolios.0.ccy',
        'export.accounts.0.ccy',
        'export.assets.0.ccy',
      ]);
    }
  });

  it('survives the awkward numbers of a hand-edited file', () => {
    const data = withFixture({
      accounts: [{ id: 'a1', name: 'X', type: 'ordem', members: ['m1'], opening: '1 000' }],
      tx: [
        { id: 't1', acc: 'a1', date: '2026-01-01', desc: 'A', amount: 0.1 + 0.2 },
        { id: 't2', acc: 'a1', date: '2026-02-30', desc: 'bad date', amount: 1 },
        { id: 't3', acc: 'a1', date: '2026-01-02', desc: 'NaN-ish', amount: 'abc' },
        { id: 't4', acc: 'a1', date: '2026-01-03', desc: 'big', amount: 1e20 },
        {
          id: 't5',
          acc: 'a1',
          date: '2026-01-04',
          desc: 'text\u0000with\u0001controls',
          amount: '12,5',
        },
      ],
      rules: [],
      assets: [],
      ops: [],
      plans: [],
      pfMoves: [],
      interest: [],
      products: [],
    });
    const built = plan(data);
    expect(built.accounts[0]?.values.opening).toBe('0');
    expect(built.transactions.map((tx) => [tx.description, tx.amount])).toEqual([
      ['A', '0.3'],
      ['text with controls', '12.5'],
    ]);
    expect(warningsOf(built).transaction_skipped).toBe(3);
  });
});
