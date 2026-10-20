import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  assetsRepo,
  investmentOpsRepo,
  newId,
  plansRepo,
  portfoliosRepo,
  subAccountsRepo,
  type InvestmentOpValues,
  type PlanValues,
  type PoolContext,
  type PoolTx,
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
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

const portfolio = (tx: PoolTx, ctx: PoolContext, name = 'Reforma') =>
  portfoliosRepo.insert(tx, ctx, newId(), {
    name,
    color: '#112233',
    currency: 'EUR',
    note: null,
    targets: {},
  });

const asset = (tx: PoolTx, ctx: PoolContext, ticker = 'VWCE') =>
  assetsRepo.insert(tx, ctx, newId(), {
    ticker,
    symbol: null,
    name: ticker,
    type: 'etf',
    currency: 'EUR',
    sector: null,
    region: null,
    dps: null,
    divMonths: [],
  });

const account = (tx: PoolTx, ctx: PoolContext, name = 'XTB') =>
  accountsRepo.insert(tx, ctx, newId(), {
    type: 'brokerage',
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

const buy = (
  portfolioId: string,
  assetId: string,
  overrides: Partial<InvestmentOpValues> = {},
): InvestmentOpValues => ({
  portfolioId,
  assetId,
  accountId: null,
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
  extId: null,
  note: null,
  ...overrides,
});

const planValues = (
  portfolioId: string,
  assetId: string,
  overrides: Partial<PlanValues> = {},
): PlanValues => ({
  portfolioId,
  assetId,
  accountId: null,
  subAccountId: null,
  amount: '100',
  day: 5,
  active: true,
  ...overrides,
});

/** A portfolio and an asset in one pool, for the tests that need both. */
const base = async (tx: PoolTx, ctx: PoolContext) => ({
  p: await portfolio(tx, ctx),
  x: await asset(tx, ctx),
});

describe('portfolios repository', () => {
  it('inserts, finds, lists, updates and removes inside the pool', async () => {
    const { a } = createTwoPools();
    const created = await withPool(a.ctx, (tx) => portfolio(tx, a.ctx));
    expect(created).toMatchObject({ poolId: a.poolId, name: 'Reforma', targets: {} });
    expect(
      (await withPool(a.ctx, (tx) => portfoliosRepo.listWithCounts(tx, a.ctx))).map(
        (p) => p.opsCount,
      ),
    ).toEqual([0]);
    const updated = await withPool(a.ctx, (tx) =>
      portfoliosRepo.update(tx, a.ctx, created.id, {
        name: 'Novo',
        color: '#AABBCC',
        currency: 'USD',
        note: 'nota',
        targets: { etf: '60' },
      }),
    );
    expect(updated).toMatchObject({ name: 'Novo', currency: 'USD', targets: { etf: '60' } });
    expect(await withPool(a.ctx, (tx) => portfoliosRepo.remove(tx, a.ctx, created.id))).toBe(true);
    expect(await withPool(a.ctx, (tx) => portfoliosRepo.find(tx, a.ctx, created.id))).toBe(
      undefined,
    );
  });

  it('keeps a name unique inside a pool only, and checks colour, currency and targets', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => portfolio(tx, a.ctx));
    expect(await failureCodeOf(withPool(a.ctx, (tx) => portfolio(tx, a.ctx)))).toBe(
      UNIQUE_VIOLATION,
    );
    await withPool(b.ctx, (tx) => portfolio(tx, b.ctx));
    const insert = (overrides: Record<string, unknown>) =>
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          portfoliosRepo.insert(tx, a.ctx, newId(), {
            name: 'Outra',
            color: '#112233',
            currency: 'EUR',
            note: null,
            targets: {},
            ...overrides,
          }),
        ),
      );
    expect(await insert({ color: 'red' })).toBe(CHECK_VIOLATION);
    expect(await insert({ currency: 'euro' })).toBe(CHECK_VIOLATION);
    expect(await insert({ targets: [] })).toBe(CHECK_VIOLATION);
  });

  it('refuses to delete a portfolio that has operations, and counts them', async () => {
    const { a } = createTwoPools();
    const { p, x } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    await withPool(a.ctx, (tx) => investmentOpsRepo.insert(tx, a.ctx, newId(), buy(p.id, x.id)));
    expect(await withPool(a.ctx, (tx) => portfoliosRepo.countOps(tx, a.ctx, p.id))).toBe(1);
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => portfoliosRepo.remove(tx, a.ctx, p.id))),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('deletes its plans with it and unlinks the accounts that pointed to it', async () => {
    const { a } = createTwoPools();
    const { p, x } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    const plan = await withPool(a.ctx, (tx) =>
      plansRepo.insert(tx, a.ctx, newId(), planValues(p.id, x.id)),
    );
    const linked = await withPool(a.ctx, async (tx) => {
      const acc = await account(tx, a.ctx);
      return accountsRepo.update(tx, a.ctx, acc.id, {
        type: 'brokerage',
        name: 'XTB',
        institution: null,
        iban: null,
        currency: 'EUR',
        opening: '0',
        openingDate: null,
        trackCash: true,
        groupName: null,
        portfolioId: p.id,
        rate: null,
        xtbAccountNo: null,
      });
    });
    expect(linked?.portfolioId).toBe(p.id);
    await withPool(a.ctx, (tx) => portfoliosRepo.remove(tx, a.ctx, p.id));
    expect(await withPool(a.ctx, (tx) => plansRepo.find(tx, a.ctx, plan.id))).toBeUndefined();
    const after = await withPool(a.ctx, (tx) => accountsRepo.find(tx, a.ctx, linked?.id ?? ''));
    expect(after).toMatchObject({ portfolioId: null, poolId: a.poolId });
  });

  it('stores SQL injection payloads in text fields literally', async () => {
    const { a } = createTwoPools();
    const payload = "'; DROP TABLE portfolios; --";
    const created = await withPool(a.ctx, (tx) =>
      portfoliosRepo.insert(tx, a.ctx, newId(), {
        name: "' OR 1=1 --",
        color: '#112233',
        currency: 'EUR',
        note: payload,
        targets: { [payload]: '10' },
      }),
    );
    expect(await withPool(a.ctx, (tx) => portfoliosRepo.find(tx, a.ctx, created.id))).toMatchObject(
      {
        name: "' OR 1=1 --",
        note: payload,
        targets: { [payload]: '10' },
      },
    );
    expect(await withPool(a.ctx, (tx) => portfoliosRepo.list(tx, a.ctx))).toHaveLength(1);
  });
});

describe('investment operations repository', () => {
  it('inserts and reads buys, sells and dividends with exact decimals', async () => {
    const { a } = createTwoPools();
    const { p, x } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    const created = await withPool(a.ctx, (tx) =>
      investmentOpsRepo.insert(
        tx,
        a.ctx,
        newId(),
        buy(p.id, x.id, { qty: '0.1', price: '0.2', fee: '0.3', note: "' OR 1=1 --" }),
      ),
    );
    expect(created).toMatchObject({
      poolId: a.poolId,
      qty: '0.10000000',
      price: '0.200000',
      fee: '0.3000',
      note: "' OR 1=1 --",
    });
    const dividend = await withPool(a.ctx, (tx) =>
      investmentOpsRepo.insert(
        tx,
        a.ctx,
        newId(),
        buy(p.id, x.id, {
          type: 'dividend',
          qty: null,
          price: null,
          amount: '34',
          gross: '40',
          tax: '6',
        }),
      ),
    );
    expect(dividend).toMatchObject({ type: 'dividend', amount: '34.0000', tax: '6.0000' });
    const listed = await withPool(a.ctx, (tx) =>
      investmentOpsRepo.list(tx, a.ctx, { type: 'dividend', portfolioId: p.id }),
    );
    expect(listed.map((op) => op.id)).toEqual([dividend.id]);
  });

  it('checks the fields of each type, the fee and the extId length', async () => {
    const { a } = createTwoPools();
    const { p, x } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    const insert = (overrides: Partial<InvestmentOpValues>) =>
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          investmentOpsRepo.insert(tx, a.ctx, newId(), buy(p.id, x.id, overrides)),
        ),
      );
    expect(await insert({ qty: '0' })).toBe(CHECK_VIOLATION);
    expect(await insert({ qty: null })).toBe(CHECK_VIOLATION);
    expect(await insert({ price: '-1' })).toBe(CHECK_VIOLATION);
    expect(await insert({ type: 'sell', price: null })).toBe(CHECK_VIOLATION);
    expect(await insert({ type: 'dividend', qty: null, price: null, amount: null })).toBe(
      CHECK_VIOLATION,
    );
    expect(await insert({ type: 'split' as never })).toBe(CHECK_VIOLATION);
    expect(await insert({ fee: '-1' })).toBe(CHECK_VIOLATION);
    expect(await insert({ extId: '' })).toBe(CHECK_VIOLATION);
    expect(await insert({ planPeriod: '2026-13' })).toBe(CHECK_VIOLATION);
  });

  it('keeps (account, extId) unique when the extId exists', async () => {
    const { a } = createTwoPools();
    const { p, x } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    const insert = (accountId: string | null, extId: string | null) =>
      withPool(a.ctx, (tx) =>
        investmentOpsRepo.insert(tx, a.ctx, newId(), buy(p.id, x.id, { accountId, extId })),
      );
    await insert(acc.id, 'T-1');
    expect(await failureCodeOf(insert(acc.id, 'T-1'))).toBe(UNIQUE_VIOLATION);
    await insert(acc.id, 'T-2');
    await insert(acc.id, null);
    await insert(acc.id, null);
  });

  it('refuses a sub-account that belongs to another account (composite foreign key)', async () => {
    const { a } = createTwoPools();
    const { p, x } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    const [one, two, sub] = await withPool(a.ctx, async (tx) => {
      const first = await account(tx, a.ctx, 'Um');
      const second = await account(tx, a.ctx, 'Dois');
      const created = await subAccountsRepo.insert(tx, a.ctx, first.id, newId(), {
        name: 'Subscrição 1',
        holderId: null,
      });
      return [first, second, created] as const;
    });
    await withPool(a.ctx, (tx) =>
      investmentOpsRepo.insert(
        tx,
        a.ctx,
        newId(),
        buy(p.id, x.id, { accountId: one.id, subAccountId: sub.id }),
      ),
    );
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          investmentOpsRepo.insert(
            tx,
            a.ctx,
            newId(),
            buy(p.id, x.id, { accountId: two.id, subAccountId: sub.id }),
          ),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          investmentOpsRepo.insert(tx, a.ctx, newId(), buy(p.id, x.id, { subAccountId: sub.id })),
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('counts by asset and account, moves and removes a portfolio’s operations', async () => {
    const { a } = createTwoPools();
    const { p, x } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    const other = await withPool(a.ctx, (tx) => portfolio(tx, a.ctx, 'Outra'));
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    for (const accountId of [acc.id, null]) {
      await withPool(a.ctx, (tx) =>
        investmentOpsRepo.insert(tx, a.ctx, newId(), buy(p.id, x.id, { accountId })),
      );
    }
    expect(await withPool(a.ctx, (tx) => investmentOpsRepo.countByAsset(tx, a.ctx, x.id))).toBe(2);
    expect(await withPool(a.ctx, (tx) => investmentOpsRepo.countByAccount(tx, a.ctx, acc.id))).toBe(
      1,
    );
    expect(
      await withPool(a.ctx, (tx) => investmentOpsRepo.moveAll(tx, a.ctx, p.id, other.id)),
    ).toBe(2);
    expect(await withPool(a.ctx, (tx) => portfoliosRepo.countOps(tx, a.ctx, other.id))).toBe(2);
    expect(await withPool(a.ctx, (tx) => investmentOpsRepo.removeAll(tx, a.ctx, other.id))).toBe(2);
    expect(await withPool(a.ctx, (tx) => investmentOpsRepo.list(tx, a.ctx))).toEqual([]);
  });

  it('treats filter values as data, not as SQL', async () => {
    const { a } = createTwoPools();
    const { p, x } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    await withPool(a.ctx, (tx) => investmentOpsRepo.insert(tx, a.ctx, newId(), buy(p.id, x.id)));
    const found = await withPool(a.ctx, (tx) =>
      investmentOpsRepo.list(tx, a.ctx, {
        portfolioId: p.id,
        // @ts-expect-error -- a hostile value where a type is expected is still just a bound value
        type: "buy' OR 1=1 --",
      }),
    );
    expect(found).toEqual([]);
    expect(await withPool(a.ctx, (tx) => investmentOpsRepo.list(tx, a.ctx))).toHaveLength(1);
  });
});

describe('plans repository', () => {
  it('inserts, lists, updates and removes inside the pool', async () => {
    const { a } = createTwoPools();
    const { p, x } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    const created = await withPool(a.ctx, (tx) =>
      plansRepo.insert(tx, a.ctx, newId(), planValues(p.id, x.id)),
    );
    expect(created).toMatchObject({ poolId: a.poolId, amount: '100.0000', day: 5, active: true });
    expect(await withPool(a.ctx, (tx) => plansRepo.list(tx, a.ctx, p.id))).toHaveLength(1);
    expect(await withPool(a.ctx, (tx) => plansRepo.list(tx, a.ctx, newId()))).toHaveLength(0);
    const updated = await withPool(a.ctx, (tx) =>
      plansRepo.update(tx, a.ctx, created.id, planValues(p.id, x.id, { day: 28, active: false })),
    );
    expect(updated).toMatchObject({ day: 28, active: false });
    expect(await withPool(a.ctx, (tx) => plansRepo.remove(tx, a.ctx, created.id))).toBe(true);
  });

  it('checks the amount and the day (1–28)', async () => {
    const { a } = createTwoPools();
    const { p, x } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    const insert = (overrides: Partial<PlanValues>) =>
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          plansRepo.insert(tx, a.ctx, newId(), planValues(p.id, x.id, overrides)),
        ),
      );
    expect(await insert({ amount: '0' })).toBe(CHECK_VIOLATION);
    expect(await insert({ day: 0 })).toBe(CHECK_VIOLATION);
    expect(await insert({ day: 29 })).toBe(CHECK_VIOLATION);
  });

  it('allows one buy per plan and month, and keeps the buy when the plan is deleted', async () => {
    const { a } = createTwoPools();
    const { p, x } = await withPool(a.ctx, (tx) => base(tx, a.ctx));
    const plan = await withPool(a.ctx, (tx) =>
      plansRepo.insert(tx, a.ctx, newId(), planValues(p.id, x.id)),
    );
    const run = (period: string) =>
      withPool(a.ctx, (tx) =>
        investmentOpsRepo.insert(
          tx,
          a.ctx,
          newId(),
          buy(p.id, x.id, { planId: plan.id, planPeriod: period }),
        ),
      );
    const first = await run('2026-03');
    expect(await failureCodeOf(run('2026-03'))).toBe(UNIQUE_VIOLATION);
    await run('2026-04');
    expect(
      (
        await withPool(a.ctx, (tx) =>
          investmentOpsRepo.findByPlanPeriod(tx, a.ctx, plan.id, '2026-03'),
        )
      )?.id,
    ).toBe(first.id);
    await withPool(a.ctx, (tx) => plansRepo.remove(tx, a.ctx, plan.id));
    const kept = await withPool(a.ctx, (tx) => investmentOpsRepo.find(tx, a.ctx, first.id));
    expect(kept).toMatchObject({ planId: null, poolId: a.poolId });
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const { p, x } = await base(tx, ctxB);
    const plan = await plansRepo.insert(tx, ctxB, newId(), planValues(p.id, x.id));
    const op = await investmentOpsRepo.insert(
      tx,
      ctxB,
      newId(),
      buy(p.id, x.id, { planId: plan.id, planPeriod: '2026-03', note: 'pool B secret' }),
    );
    return { portfolioId: p.id, assetId: x.id, planId: plan.id, opId: op.id };
  };
  const snapshot = async (tx: PoolTx, ctxB: PoolContext) => ({
    portfolios: await portfoliosRepo.list(tx, ctxB),
    plans: await plansRepo.list(tx, ctxB),
    ops: await investmentOpsRepo.list(tx, ctxB),
  });
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('portfolios: list finds nothing of pool B', () =>
    check((tx, ctxA) => portfoliosRepo.list(tx, ctxA)));
  it('portfolios: find finds nothing of pool B', () =>
    check((tx, ctxA, s) => portfoliosRepo.find(tx, ctxA, s.portfolioId)));
  it('portfolios: listWithCounts counts nothing of pool B', () =>
    check((tx, ctxA) => portfoliosRepo.listWithCounts(tx, ctxA)));
  it('portfolios: update changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      portfoliosRepo.update(tx, ctxA, s.portfolioId, {
        name: 'hijacked',
        color: '#000000',
        currency: 'EUR',
        note: null,
        targets: {},
      }),
    ));
  it('portfolios: remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => portfoliosRepo.remove(tx, ctxA, s.portfolioId)));
  it('portfolios: countOps counts nothing of pool B', () =>
    check((tx, ctxA, s) => portfoliosRepo.countOps(tx, ctxA, s.portfolioId)));
  it('portfolios: countPlans counts nothing of pool B', () =>
    check((tx, ctxA, s) => portfoliosRepo.countPlans(tx, ctxA, s.portfolioId)));

  it('plans: list finds nothing of pool B', () => check((tx, ctxA) => plansRepo.list(tx, ctxA)));
  it('plans: find finds nothing of pool B', () =>
    check((tx, ctxA, s) => plansRepo.find(tx, ctxA, s.planId)));
  it('plans: update changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      plansRepo.update(tx, ctxA, s.planId, planValues(s.portfolioId, s.assetId, { day: 1 })),
    ));
  it('plans: remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => plansRepo.remove(tx, ctxA, s.planId)));
  it('plans: moveAll moves nothing of pool B', () =>
    check((tx, ctxA, s) => plansRepo.moveAll(tx, ctxA, s.portfolioId, newId())));
  it('plans: removeAll deletes nothing of pool B', () =>
    check((tx, ctxA, s) => plansRepo.removeAll(tx, ctxA, s.portfolioId)));
  it('plans: the counts find nothing of pool B', async () => {
    await check((tx, ctxA, s) => plansRepo.countByPortfolio(tx, ctxA, s.portfolioId));
    await check((tx, ctxA, s) => plansRepo.countByAsset(tx, ctxA, s.assetId));
    await check((tx, ctxA) => plansRepo.countByAccount(tx, ctxA, newId()));
    await check((tx, ctxA) => plansRepo.countBySubAccount(tx, ctxA, newId()));
  });

  it('ops: list finds nothing of pool B', () =>
    check((tx, ctxA) => investmentOpsRepo.list(tx, ctxA)));
  it('ops: find finds nothing of pool B', () =>
    check((tx, ctxA, s) => investmentOpsRepo.find(tx, ctxA, s.opId)));
  it('ops: findByPlanPeriod finds nothing of pool B', () =>
    check((tx, ctxA, s) => investmentOpsRepo.findByPlanPeriod(tx, ctxA, s.planId, '2026-03')));
  it('ops: update changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      investmentOpsRepo.update(tx, ctxA, s.opId, buy(s.portfolioId, s.assetId, { qty: '99' })),
    ));
  it('ops: remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => investmentOpsRepo.remove(tx, ctxA, s.opId)));
  it('ops: moveAll moves nothing of pool B', () =>
    check((tx, ctxA, s) => investmentOpsRepo.moveAll(tx, ctxA, s.portfolioId, newId())));
  it('ops: countBySubAccount counts nothing of pool B', () =>
    check((tx, ctxA) => investmentOpsRepo.countBySubAccount(tx, ctxA, newId())));
  it('ops: removeAll deletes nothing of pool B', () =>
    check((tx, ctxA, s) => investmentOpsRepo.removeAll(tx, ctxA, s.portfolioId)));
  it('ops: countByAsset counts nothing of pool B', () =>
    check((tx, ctxA, s) => investmentOpsRepo.countByAsset(tx, ctxA, s.assetId)));
  it('ops: countByAccount counts nothing of pool B', () =>
    check((tx, ctxA) => investmentOpsRepo.countByAccount(tx, ctxA, newId())));

  it('an operation for pool B’s portfolio cannot be written as pool A (composite foreign key)', async () => {
    const { a, b } = createTwoPools();
    const seeded = await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    const mine = await withPool(a.ctx, (tx) => asset(tx, a.ctx));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          investmentOpsRepo.insert(tx, a.ctx, newId(), buy(seeded.portfolioId, mine.id)),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});
