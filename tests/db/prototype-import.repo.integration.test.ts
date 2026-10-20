import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  assetsRepo,
  categoriesRepo,
  categoryRulesRepo,
  investmentOpsRepo,
  newId,
  poolDataRepo,
  portfoliosRepo,
  transactionsRepo,
  type ImportedTransactionValues,
  type InvestmentOpValues,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';

import { expectIsolated } from '../support/expect-isolated';

import { createTwoPools, failureCodeOf, openTestDatabase } from './harness';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

// The repository functions the prototype import (NES-47) added: bulk inserts for movements, rules
// and operations, the pair update, and the counts behind the "empty pool" check.

const database = openTestDatabase(2);
const { withPool } = database;

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
});

const PAYLOAD = "x'); DROP TABLE transactions; -- ' OR 1=1 --";

const account = (tx: PoolTx, ctx: PoolContext) =>
  accountsRepo.insert(tx, ctx, newId(), {
    type: 'brokerage',
    name: 'Corretora',
    institution: null,
    iban: null,
    currency: 'EUR',
    opening: '0',
    openingDate: null,
    trackCash: true,
    groupName: null,
    portfolioId: null,
    rate: null,
    xtbAccountNo: null,
  });

const movement = (
  accountId: string,
  overrides: Partial<ImportedTransactionValues> = {},
): ImportedTransactionValues => ({
  id: newId(),
  accountId,
  date: '2026-03-10',
  description: 'COMPRA',
  amount: '-12.5',
  categoryId: null,
  transfer: false,
  transferLocked: false,
  manualCategory: false,
  depositInterest: false,
  hash: `h-${newId()}`,
  ...overrides,
});

describe('transactionsRepo.insertMany and setPairs', () => {
  it('inserts a large batch in chunks, with the flags the import carries', async () => {
    const { a } = createTwoPools();
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    const many = Array.from({ length: 1203 }, (_, index) =>
      movement(acc.id, { description: `linha ${index}`, depositInterest: index === 7 }),
    );
    await withPool(a.ctx, (tx) => transactionsRepo.insertMany(tx, a.ctx, many));
    const stored = await withPool(a.ctx, (tx) => transactionsRepo.listForEngine(tx, a.ctx));
    expect(stored).toHaveLength(1203);
    const linked = await withPool(
      a.ctx,
      async (tx) =>
        (await tx.execute(sql`select count(*)::int as n from transactions where dep_link`)).rows,
    );
    expect(linked).toEqual([{ n: 1 }]);
  });

  it('keeps a payload with SQL in it as text, and refuses a repeated hash in the account', async () => {
    const { a } = createTwoPools();
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    await withPool(a.ctx, (tx) =>
      transactionsRepo.insertMany(tx, a.ctx, [
        movement(acc.id, { description: PAYLOAD, hash: PAYLOAD }),
      ]),
    );
    const [row] = await withPool(a.ctx, (tx) => transactionsRepo.listForEngine(tx, a.ctx));
    expect(row?.description).toBe(PAYLOAD);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          transactionsRepo.insertMany(tx, a.ctx, [movement(acc.id, { hash: PAYLOAD })]),
        ),
      ),
    ).toBe(UNIQUE_VIOLATION);
    // The failed batch left the rest alone.
    expect(await withPool(a.ctx, (tx) => transactionsRepo.listForEngine(tx, a.ctx))).toHaveLength(
      1,
    );
  });

  it('writes all or none of a batch: one bad row undoes the chunk', async () => {
    const { a } = createTwoPools();
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    const good = movement(acc.id);
    const bad = movement(acc.id, { description: '' });
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => transactionsRepo.insertMany(tx, a.ctx, [good, bad])),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(await withPool(a.ctx, (tx) => transactionsRepo.listForEngine(tx, a.ctx))).toEqual([]);
  });

  it('sets the pair of both sides, and only for movements of the pool', async () => {
    const { a } = createTwoPools();
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    const out = movement(acc.id, { amount: '-5', transfer: true });
    const into = movement(acc.id, { amount: '5', transfer: true });
    await withPool(a.ctx, async (tx) => {
      await transactionsRepo.insertMany(tx, a.ctx, [out, into]);
      await transactionsRepo.setPairs(tx, a.ctx, [
        { id: out.id, pairId: into.id },
        { id: into.id, pairId: out.id },
      ]);
    });
    const rows = await withPool(a.ctx, (tx) => transactionsRepo.listForEngine(tx, a.ctx));
    expect(rows.find((row) => row.id === out.id)?.pairId).toBe(into.id);
    expect(rows.find((row) => row.id === into.id)?.pairId).toBe(out.id);
    // A movement cannot be paired with a movement that does not exist (the foreign key says so).
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          transactionsRepo.setPairs(tx, a.ctx, [{ id: out.id, pairId: newId() }]),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe('categoryRulesRepo.insertMany', () => {
  it('adds rules after the existing ones, in order, with payloads kept as text', async () => {
    const { a } = createTwoPools();
    const [category] = await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx));
    const categoryId = category?.id ?? '';
    await withPool(a.ctx, async (tx) => {
      await categoryRulesRepo.insert(tx, a.ctx, newId(), {
        keyword: 'ANTES',
        categoryId,
        accountId: null,
      });
      await categoryRulesRepo.insertMany(tx, a.ctx, [
        { id: newId(), keyword: 'UM', categoryId, accountId: null },
        { id: newId(), keyword: PAYLOAD.slice(0, 60), categoryId, accountId: null },
      ]);
    });
    const rules = await withPool(a.ctx, (tx) => categoryRulesRepo.list(tx, a.ctx));
    expect(rules.map((rule) => [rule.keyword, rule.position])).toEqual([
      ['ANTES', 1],
      ['UM', 2],
      [PAYLOAD.slice(0, 60), 3],
    ]);
  });
});

describe('investmentOpsRepo.insertMany', () => {
  const op = (portfolioId: string, assetId: string, note: string | null): InvestmentOpValues => ({
    portfolioId,
    assetId,
    accountId: null,
    subAccountId: null,
    type: 'buy',
    date: '2026-02-01',
    qty: '1.5',
    price: '10',
    fee: null,
    amount: null,
    gross: null,
    tax: null,
    fromCash: false,
    planId: null,
    planPeriod: null,
    extId: note,
    note,
  });

  it('inserts operations with their own ids and keeps text as text', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, async (tx) => {
      const portfolio = await portfoliosRepo.insert(tx, a.ctx, newId(), {
        name: 'P',
        color: '#112233',
        currency: 'EUR',
        note: null,
        targets: {},
      });
      const asset = await assetsRepo.insert(tx, a.ctx, newId(), {
        ticker: 'VWCE',
        symbol: null,
        name: 'VWCE',
        type: 'etf',
        currency: 'EUR',
        sector: null,
        region: null,
        dps: null,
        divMonths: [],
      });
      const id = newId();
      await investmentOpsRepo.insertMany(tx, a.ctx, [
        { id, ...op(portfolio.id, asset.id, PAYLOAD.slice(0, 100)) },
        { id: newId(), ...op(portfolio.id, asset.id, null) },
      ]);
      const stored = await investmentOpsRepo.find(tx, a.ctx, id);
      expect(stored).toMatchObject({
        id,
        poolId: a.poolId,
        qty: '1.50000000',
        extId: PAYLOAD.slice(0, 100),
      });
      expect(await investmentOpsRepo.list(tx, a.ctx)).toHaveLength(2);
    });
  });
});

describe('poolDataRepo', () => {
  it('counts what the pool holds, and nothing of another pool', async () => {
    const { a, b } = createTwoPools();
    const empty = await withPool(a.ctx, (tx) => poolDataRepo.counts(tx, a.ctx));
    expect(Object.values(empty).every((count) => count === 0)).toBe(true);
    const acc = await withPool(b.ctx, (tx) => account(tx, b.ctx));
    await withPool(b.ctx, (tx) => transactionsRepo.insertMany(tx, b.ctx, [movement(acc.id)]));
    await withPool(a.ctx, (tx) =>
      categoriesRepo.insert(tx, a.ctx, newId(), {
        name: 'Minha',
        kind: 'expense',
        color: '#112233',
      }),
    );
    expect(await withPool(a.ctx, (tx) => poolDataRepo.counts(tx, a.ctx))).toMatchObject({
      accounts: 0,
      transactions: 0,
      ownCategories: 1,
    });
    expect(await withPool(b.ctx, (tx) => poolDataRepo.counts(tx, b.ctx))).toMatchObject({
      accounts: 1,
      transactions: 1,
      ownCategories: 0,
    });
  });

  it('takes a lock that a second transaction of the same pool waits for', async () => {
    const { a } = createTwoPools();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withPool(a.ctx, async (tx) => {
      await poolDataRepo.lockForImport(tx, a.ctx);
      order.push('first has the lock');
      await held;
      order.push('first done');
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const second = withPool(a.ctx, async (tx) => {
      await poolDataRepo.lockForImport(tx, a.ctx);
      order.push('second has the lock');
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(order).toEqual(['first has the lock']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first has the lock', 'first done', 'second has the lock']);
  });
});

describe('isolation between pools', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const acc = await account(tx, ctxB);
    const one = movement(acc.id);
    const two = movement(acc.id);
    await transactionsRepo.insertMany(tx, ctxB, [one, two]);
    return { one: one.id, two: two.id };
  };
  const snapshot = (tx: PoolTx, ctxB: PoolContext) => transactionsRepo.listForEngine(tx, ctxB);

  it('transactions: setPairs changes nothing of pool B', () =>
    expectIsolated({
      database,
      seed,
      snapshot,
      run: (tx, ctxA, s) =>
        transactionsRepo.setPairs(tx, ctxA, [
          { id: s.one, pairId: s.two },
          { id: s.two, pairId: s.one },
        ]),
    }));
  it('pool data: counts finds nothing of pool B', () =>
    expectIsolated({
      database,
      seed,
      snapshot,
      run: async (tx, ctxA) => {
        const counts = await poolDataRepo.counts(tx, ctxA);
        return [counts.accounts, counts.transactions, counts.ownCategories].filter(
          (count) => count > 0,
        );
      },
    }));
});
