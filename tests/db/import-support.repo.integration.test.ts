import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  assetsRepo,
  investmentOpsRepo,
  newId,
  portfoliosRepo,
  transactionsRepo,
  type InvestmentOpValues,
  type PoolContext,
  type PoolTx,
  type TransactionValues,
} from '@nestvault/db';

import { expectIsolated } from '../support/expect-isolated';

import { createTwoPools, openTestDatabase } from './harness';

// Repository functions the statement import (NES-57) relies on: the duplicate look-ups of the
// preview, the sum behind the opening-balance adjustment and the idempotent insert by broker id.

const database = openTestDatabase(2);
const { withPool } = database;

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
});

const account = (tx: PoolTx, ctx: PoolContext, type = 'checking') =>
  accountsRepo.insert(tx, ctx, newId(), {
    type,
    name: 'Conta',
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

const movement = (accountId: string, hash: string, amount = '-10', date = '2026-03-10') =>
  ({
    accountId,
    date,
    description: 'COMPRA',
    amount,
    categoryId: null,
    transfer: false,
    transferLocked: false,
    manualCategory: false,
    hash,
  }) satisfies TransactionValues;

const brokerSetup = async (tx: PoolTx, ctx: PoolContext) => {
  const portfolio = await portfoliosRepo.insert(tx, ctx, newId(), {
    name: 'Carteira',
    color: '#112233',
    currency: 'EUR',
    note: null,
    targets: {},
  });
  const asset = await assetsRepo.insert(tx, ctx, newId(), {
    ticker: 'AAA',
    symbol: 'AAA.US',
    name: 'Alpha',
    type: 'stock',
    currency: 'USD',
    sector: null,
    region: null,
    dps: null,
    divMonths: [],
  });
  const owner = await account(tx, ctx, 'brokerage');
  return { portfolioId: portfolio.id, assetId: asset.id, accountId: owner.id };
};

const op = (
  setup: { portfolioId: string; assetId: string; accountId: string },
  extId: string | null,
): InvestmentOpValues => ({
  portfolioId: setup.portfolioId,
  assetId: setup.assetId,
  accountId: setup.accountId,
  subAccountId: null,
  type: 'buy',
  date: '2026-03-10',
  qty: '2',
  price: '10',
  fee: null,
  amount: null,
  gross: null,
  tax: null,
  fromCash: false,
  planId: null,
  planPeriod: null,
  extId,
  note: null,
});

describe('transactionsRepo.existingHashes', () => {
  it('returns the hashes the account has, and only those', async () => {
    const { a } = createTwoPools();
    const found = await withPool(a.ctx, async (tx) => {
      const mine = await account(tx, a.ctx);
      const other = await account(tx, a.ctx);
      await transactionsRepo.insert(tx, a.ctx, newId(), movement(mine.id, 'h1'));
      await transactionsRepo.insert(tx, a.ctx, newId(), movement(mine.id, 'h2'));
      await transactionsRepo.insert(tx, a.ctx, newId(), movement(other.id, 'h3'));
      return transactionsRepo.existingHashes(tx, a.ctx, mine.id, ['h1', 'h3', 'h9']);
    });
    expect([...found]).toEqual(['h1']);
  });

  it('works across chunks and with nothing to look up', async () => {
    const { a } = createTwoPools();
    const found = await withPool(a.ctx, async (tx) => {
      const mine = await account(tx, a.ctx);
      await transactionsRepo.insert(tx, a.ctx, newId(), movement(mine.id, 'h-2500'));
      const many = Array.from({ length: 2600 }, (_, i) => `h-${i}`);
      expect(await transactionsRepo.existingHashes(tx, a.ctx, mine.id, [])).toEqual(new Set());
      return transactionsRepo.existingHashes(tx, a.ctx, mine.id, many);
    });
    expect([...found]).toEqual(['h-2500']);
  });

  it('treats an injection payload as data', async () => {
    const { a } = createTwoPools();
    const found = await withPool(a.ctx, async (tx) => {
      const mine = await account(tx, a.ctx);
      await transactionsRepo.insert(tx, a.ctx, newId(), movement(mine.id, 'h1'));
      return transactionsRepo.existingHashes(tx, a.ctx, mine.id, [
        "' OR 1=1 --",
        "'; DROP TABLE transactions; --",
      ]);
    });
    expect(found.size).toBe(0);
  });

  it('finds nothing of pool B', async () => {
    await expectIsolated({
      database,
      seed: async (tx, ctxB) => {
        const mine = await account(tx, ctxB);
        await transactionsRepo.insert(tx, ctxB, newId(), movement(mine.id, 'h1'));
        return mine.id;
      },
      snapshot: (tx, ctxB, accountId) =>
        transactionsRepo.existingHashes(tx, ctxB, accountId, ['h1']),
      run: async (tx, ctxA, accountId) => [
        ...(await transactionsRepo.existingHashes(tx, ctxA, accountId, ['h1'])),
      ],
      outcome: 'empty',
    });
  });
});

describe('transactionsRepo.sumUpTo', () => {
  it('sums the account up to a date, included, with exact decimals', async () => {
    const { a } = createTwoPools();
    const sums = await withPool(a.ctx, async (tx) => {
      const mine = await account(tx, a.ctx);
      const other = await account(tx, a.ctx);
      await transactionsRepo.insert(
        tx,
        a.ctx,
        newId(),
        movement(mine.id, 'a', '0.1', '2026-01-01'),
      );
      await transactionsRepo.insert(
        tx,
        a.ctx,
        newId(),
        movement(mine.id, 'b', '0.2', '2026-01-02'),
      );
      await transactionsRepo.insert(tx, a.ctx, newId(), movement(mine.id, 'c', '-5', '2026-01-03'));
      await transactionsRepo.insert(
        tx,
        a.ctx,
        newId(),
        movement(other.id, 'd', '99', '2026-01-01'),
      );
      return {
        some: await transactionsRepo.sumUpTo(tx, a.ctx, mine.id, '2026-01-02'),
        all: await transactionsRepo.sumUpTo(tx, a.ctx, mine.id, '2026-12-31'),
        none: await transactionsRepo.sumUpTo(tx, a.ctx, mine.id, '2025-12-31'),
      };
    });
    expect(Number(sums.some)).toBeCloseTo(0.3, 10);
    expect(Number(sums.all)).toBeCloseTo(-4.7, 10);
    expect(sums.some).toBe('0.3000');
    expect(sums.none).toBe('0');
  });

  it('counts nothing of pool B', async () => {
    await expectIsolated({
      database,
      seed: async (tx, ctxB) => {
        const mine = await account(tx, ctxB);
        await transactionsRepo.insert(tx, ctxB, newId(), movement(mine.id, 'h1', '100'));
        return mine.id;
      },
      snapshot: (tx, ctxB, accountId) =>
        transactionsRepo.sumUpTo(tx, ctxB, accountId, '2030-01-01'),
      run: async (tx, ctxA, accountId) => {
        const total = await transactionsRepo.sumUpTo(tx, ctxA, accountId, '2030-01-01');
        return total === '0' ? undefined : total;
      },
    });
  });
});

describe('investmentOpsRepo.insertIgnoringExtId / existingExtIds', () => {
  it('adds an operation once per broker id and account', async () => {
    const { a } = createTwoPools();
    const result = await withPool(a.ctx, async (tx) => {
      const setup = await brokerSetup(tx, a.ctx);
      const first = await investmentOpsRepo.insertIgnoringExtId(
        tx,
        a.ctx,
        newId(),
        op(setup, 'xtb:1'),
      );
      const again = await investmentOpsRepo.insertIgnoringExtId(
        tx,
        a.ctx,
        newId(),
        op(setup, 'xtb:1'),
      );
      const other = await investmentOpsRepo.insertIgnoringExtId(
        tx,
        a.ctx,
        newId(),
        op(setup, 'xtb:2'),
      );
      const count = (await investmentOpsRepo.list(tx, a.ctx)).length;
      const known = await investmentOpsRepo.existingExtIds(tx, a.ctx, setup.accountId, [
        'xtb:1',
        'xtb:2',
        'xtb:3',
      ]);
      return { first, again, other, count, known: [...known].sort() };
    });
    expect(result).toEqual({
      first: true,
      again: false,
      other: true,
      count: 2,
      known: ['xtb:1', 'xtb:2'],
    });
  });

  it('does not touch the row it skipped', async () => {
    const { a } = createTwoPools();
    const row = await withPool(a.ctx, async (tx) => {
      const setup = await brokerSetup(tx, a.ctx);
      const id = newId();
      await investmentOpsRepo.insertIgnoringExtId(tx, a.ctx, id, op(setup, 'xtb:1'));
      await investmentOpsRepo.insertIgnoringExtId(tx, a.ctx, newId(), {
        ...op(setup, 'xtb:1'),
        qty: '99',
      });
      return investmentOpsRepo.find(tx, a.ctx, id);
    });
    expect(row?.qty).toBe('2.00000000');
  });

  it('without a broker id every call adds a row (nothing to deduplicate by)', async () => {
    const { a } = createTwoPools();
    const added = await withPool(a.ctx, async (tx) => {
      const setup = await brokerSetup(tx, a.ctx);
      const results = [
        await investmentOpsRepo.insertIgnoringExtId(tx, a.ctx, newId(), op(setup, null)),
        await investmentOpsRepo.insertIgnoringExtId(tx, a.ctx, newId(), op(setup, null)),
      ];
      return results;
    });
    expect(added).toEqual([true, true]);
  });

  it('looks ids up as data', async () => {
    const { a } = createTwoPools();
    const known = await withPool(a.ctx, async (tx) => {
      const setup = await brokerSetup(tx, a.ctx);
      await investmentOpsRepo.insertIgnoringExtId(tx, a.ctx, newId(), op(setup, 'xtb:1'));
      return investmentOpsRepo.existingExtIds(tx, a.ctx, setup.accountId, ["' OR 1=1 --", 'xtb:1']);
    });
    expect([...known]).toEqual(['xtb:1']);
  });

  it('existingExtIds finds nothing of pool B', async () => {
    await expectIsolated({
      database,
      seed: async (tx, ctxB) => {
        const setup = await brokerSetup(tx, ctxB);
        await investmentOpsRepo.insertIgnoringExtId(tx, ctxB, newId(), op(setup, 'xtb:1'));
        return setup;
      },
      snapshot: (tx, ctxB) => investmentOpsRepo.list(tx, ctxB),
      run: async (tx, ctxA, setup) => [
        ...(await investmentOpsRepo.existingExtIds(tx, ctxA, setup.accountId, ['xtb:1'])),
      ],
      outcome: 'empty',
    });
  });

  it('insertIgnoringExtId cannot write into pool B’s portfolio', async () => {
    await expectIsolated({
      database,
      seed: (tx, ctxB) => brokerSetup(tx, ctxB),
      snapshot: (tx, ctxB) => investmentOpsRepo.list(tx, ctxB),
      outcome: 'rejects',
      refusal: (error) =>
        (error instanceof Error && (error.cause as { code?: string } | undefined)?.code) ===
        '23503',
      run: (tx, ctxA, setup) =>
        investmentOpsRepo.insertIgnoringExtId(tx, ctxA, newId(), op(setup, 'xtb:9')),
    });
  });
});
