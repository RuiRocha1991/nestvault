import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  newId,
  portfolioCashMovesRepo,
  portfoliosRepo,
  transactionsRepo,
  type PoolContext,
  type PoolTx,
  type PortfolioCashMoveValues,
} from '@nestvault/db';

import { expectIsolated } from '../support/expect-isolated';

import { createTwoPools, failureCodeOf, openTestDatabase } from './harness';

const database = openTestDatabase(2);
const { withPool } = database;

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
});

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

const portfolio = (tx: PoolTx, ctx: PoolContext, name = 'Reforma') =>
  portfoliosRepo.insert(tx, ctx, newId(), {
    name,
    color: '#112233',
    currency: 'EUR',
    note: null,
    targets: {},
  });

const account = (tx: PoolTx, ctx: PoolContext, name = 'Conta') =>
  accountsRepo.insert(tx, ctx, newId(), {
    type: 'checking',
    name,
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

const bankLine = (tx: PoolTx, ctx: PoolContext, accountId: string, amount = '100') =>
  transactionsRepo.insert(tx, ctx, newId(), {
    accountId,
    date: '2026-03-12',
    description: 'Transferencia',
    amount,
    categoryId: null,
    transfer: false,
    transferLocked: false,
    manualCategory: false,
    hash: `h-${newId()}`,
  });

const move = (
  portfolioId: string,
  accountId: string,
  overrides: Partial<PortfolioCashMoveValues> = {},
): PortfolioCashMoveValues => ({
  portfolioId,
  accountId,
  date: '2026-03-12',
  amount: '-100',
  note: null,
  transactionId: null,
  mirror: false,
  ...overrides,
});

const base = async (tx: PoolTx, ctx: PoolContext) => ({
  p: await portfolio(tx, ctx),
  acc: await account(tx, ctx),
});

describe('portfolio cash moves repository', () => {
  it('inserts, finds, lists, links, moves and removes inside the pool', async () => {
    const { a } = createTwoPools();
    const { p, p2, acc } = await withPool(a.ctx, async (tx) => ({
      ...(await base(tx, a.ctx)),
      p2: await portfolio(tx, a.ctx, 'Outra'),
    }));
    const created = await withPool(a.ctx, (tx) =>
      portfolioCashMovesRepo.insert(tx, a.ctx, newId(), move(p.id, acc.id, { note: 'nota' })),
    );
    expect(created).toMatchObject({
      poolId: a.poolId,
      amount: '-100.0000',
      note: 'nota',
      mirror: false,
      transactionId: null,
    });
    expect(
      await withPool(a.ctx, (tx) => portfolioCashMovesRepo.find(tx, a.ctx, created.id)),
    ).toMatchObject({ id: created.id });
    expect(await withPool(a.ctx, (tx) => portfolioCashMovesRepo.list(tx, a.ctx))).toHaveLength(1);
    expect(
      await withPool(a.ctx, (tx) => portfolioCashMovesRepo.list(tx, a.ctx, { portfolioId: p2.id })),
    ).toHaveLength(0);
    expect(await withPool(a.ctx, (tx) => portfolioCashMovesRepo.count(tx, a.ctx, p.id))).toBe(1);

    const unlinked = await withPool(a.ctx, (tx) =>
      portfolioCashMovesRepo.listUnlinked(tx, a.ctx, '2026-03-10', '2026-03-14'),
    );
    expect(unlinked.map((row) => row.id)).toEqual([created.id]);
    expect(
      await withPool(a.ctx, (tx) =>
        portfolioCashMovesRepo.listUnlinked(tx, a.ctx, '2026-04-01', '2026-04-30'),
      ),
    ).toHaveLength(0);

    const line = await withPool(a.ctx, (tx) => bankLine(tx, a.ctx, acc.id));
    expect(
      await withPool(a.ctx, (tx) =>
        portfolioCashMovesRepo.linkTransaction(tx, a.ctx, created.id, line.id),
      ),
    ).toBe(true);
    // A move is linked once.
    expect(
      await withPool(a.ctx, (tx) =>
        portfolioCashMovesRepo.linkTransaction(tx, a.ctx, created.id, line.id),
      ),
    ).toBe(false);
    expect(
      await withPool(a.ctx, (tx) =>
        portfolioCashMovesRepo.listUnlinked(tx, a.ctx, '2026-03-10', '2026-03-14'),
      ),
    ).toHaveLength(0);

    await withPool(a.ctx, (tx) => portfolioCashMovesRepo.moveAll(tx, a.ctx, p.id, p2.id));
    expect(await withPool(a.ctx, (tx) => portfolioCashMovesRepo.count(tx, a.ctx, p2.id))).toBe(1);

    expect(
      await withPool(a.ctx, (tx) => portfolioCashMovesRepo.remove(tx, a.ctx, created.id)),
    ).toBe(true);
    expect(
      await withPool(a.ctx, (tx) => portfolioCashMovesRepo.remove(tx, a.ctx, created.id)),
    ).toBe(false);
  });

  it('checks the amount is not zero and the note length', async () => {
    const { a } = createTwoPools();
    const { p, acc } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    const insert = (overrides: Partial<PortfolioCashMoveValues>) =>
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          portfolioCashMovesRepo.insert(tx, a.ctx, newId(), move(p.id, acc.id, overrides)),
        ),
      );
    expect(await insert({ amount: '0' })).toBe(CHECK_VIOLATION);
    expect(await insert({ note: 'x'.repeat(2001) })).toBe(CHECK_VIOLATION);
  });

  it('cannot reference a portfolio, an account or a movement of another pool (composite keys)', async () => {
    const { a, b } = createTwoPools();
    const own = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    const foreign = await withPool(b.ctx, async (tx) => ({
      ...(await base(tx, b.ctx)),
    }));
    const foreignLine = await withPool(b.ctx, (tx) => bankLine(tx, b.ctx, foreign.acc.id));
    const insert = (values: PortfolioCashMoveValues) =>
      failureCodeOf(
        withPool(a.ctx, (tx) => portfolioCashMovesRepo.insert(tx, a.ctx, newId(), values)),
      );
    expect(await insert(move(foreign.p.id, own.acc.id))).toBe(FOREIGN_KEY_VIOLATION);
    expect(await insert(move(own.p.id, foreign.acc.id))).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await insert(move(own.p.id, own.acc.id, { transactionId: foreignLine.id, mirror: true })),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('goes with its portfolio, restricts the account and unlinks a deleted movement', async () => {
    const { a } = createTwoPools();
    const { p, acc } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    const line = await withPool(a.ctx, (tx) => bankLine(tx, a.ctx, acc.id));
    const created = await withPool(a.ctx, (tx) =>
      portfolioCashMovesRepo.insert(
        tx,
        a.ctx,
        newId(),
        move(p.id, acc.id, { transactionId: line.id, mirror: true }),
      ),
    );
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => accountsRepo.remove(tx, a.ctx, acc.id))),
    ).toBe(FOREIGN_KEY_VIOLATION);
    await withPool(a.ctx, (tx) => transactionsRepo.remove(tx, a.ctx, line.id));
    expect(
      await withPool(a.ctx, (tx) => portfolioCashMovesRepo.find(tx, a.ctx, created.id)),
    ).toMatchObject({ transactionId: null });
    await withPool(a.ctx, (tx) => portfoliosRepo.remove(tx, a.ctx, p.id));
    expect(await withPool(a.ctx, (tx) => portfolioCashMovesRepo.list(tx, a.ctx))).toHaveLength(0);
  });

  it('stores SQL injection payloads in the note literally', async () => {
    const { a } = createTwoPools();
    const { p, acc } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    const payload = "' OR 1=1 --";
    const created = await withPool(a.ctx, (tx) =>
      portfolioCashMovesRepo.insert(tx, a.ctx, newId(), move(p.id, acc.id, { note: payload })),
    );
    expect(created.note).toBe(payload);
    // An id that looks like SQL is data: nothing is found, nothing is removed.
    expect(
      await withPool(a.ctx, (tx) =>
        portfolioCashMovesRepo.find(tx, a.ctx, payload).catch(() => null),
      ),
    ).toBeNull();
    expect(await withPool(a.ctx, (tx) => portfolioCashMovesRepo.list(tx, a.ctx))).toHaveLength(1);
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const { p, acc } = await base(tx, ctxB);
    const line = await bankLine(tx, ctxB, acc.id);
    const row = await portfolioCashMovesRepo.insert(
      tx,
      ctxB,
      newId(),
      move(p.id, acc.id, { note: 'pool B secret' }),
    );
    return { portfolioId: p.id, accountId: acc.id, moveId: row.id, lineId: line.id };
  };
  const snapshot = async (tx: PoolTx, ctxB: PoolContext) => portfolioCashMovesRepo.list(tx, ctxB);
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('list finds nothing of pool B', () =>
    check((tx, ctxA) => portfolioCashMovesRepo.list(tx, ctxA)));
  it('list with a portfolio filter finds nothing of pool B', () =>
    check((tx, ctxA, s) => portfolioCashMovesRepo.list(tx, ctxA, { portfolioId: s.portfolioId })));
  it('find finds nothing of pool B', () =>
    check((tx, ctxA, s) => portfolioCashMovesRepo.find(tx, ctxA, s.moveId)));
  it('listUnlinked finds nothing of pool B', () =>
    check((tx, ctxA) => portfolioCashMovesRepo.listUnlinked(tx, ctxA, '2026-01-01', '2026-12-31')));
  it('linkTransaction changes nothing of pool B', () =>
    check((tx, ctxA, s) => portfolioCashMovesRepo.linkTransaction(tx, ctxA, s.moveId, s.lineId)));
  it('remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => portfolioCashMovesRepo.remove(tx, ctxA, s.moveId)));
  it('moveAll changes nothing of pool B', () =>
    check((tx, ctxA, s) => portfolioCashMovesRepo.moveAll(tx, ctxA, s.portfolioId, newId())));
  it('countByAccount counts nothing of pool B', () =>
    check((tx, ctxA, s) => portfolioCashMovesRepo.countByAccount(tx, ctxA, s.accountId)));
  it('count counts nothing of pool B', () =>
    check((tx, ctxA, s) => portfolioCashMovesRepo.count(tx, ctxA, s.portfolioId)));
});
