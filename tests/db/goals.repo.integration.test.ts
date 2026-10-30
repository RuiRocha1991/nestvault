import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  goalsRepo,
  newId,
  portfoliosRepo,
  subAccountsRepo,
  type GoalValues,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';

import { expectIsolated } from '../support/expect-isolated';

import { createTwoPools, failureCodeOf, openTestDatabase, PG } from './harness';

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

const values = (patch: Partial<GoalValues> = {}): GoalValues => ({
  name: 'Independência financeira',
  color: '#9D6BFF',
  type: 'value',
  target: '500000',
  mode: 'date',
  deadline: '2040-01-01',
  monthly: '600.5',
  rate: '6',
  yield: null,
  includeSavings: false,
  ...patch,
});

const portfolio = (tx: PoolTx, ctx: PoolContext, name = 'Reforma') =>
  portfoliosRepo.insert(tx, ctx, newId(), {
    name,
    color: '#112233',
    currency: 'EUR',
    note: null,
    targets: {},
  });

const account = (tx: PoolTx, ctx: PoolContext) =>
  accountsRepo.insert(tx, ctx, newId(), {
    type: 'checking',
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

const portfolioScope = (portfolioId: string) => ({
  portfolioId,
  accountId: null,
  subAccountId: null,
});

describe('goals', () => {
  it('inserts, reads, updates and deletes a goal with its scopes', async () => {
    const { a } = createTwoPools();
    const id = newId();
    const { p, acc, sub } = await withPool(a.ctx, async (tx) => {
      const p = await portfolio(tx, a.ctx);
      const acc = await account(tx, a.ctx);
      const sub = await subAccountsRepo.insert(tx, a.ctx, acc.id, newId(), {
        name: 'Simão',
        holderId: null,
      });
      return { p, acc, sub };
    });
    await withPool(a.ctx, async (tx) => {
      await goalsRepo.insert(tx, a.ctx, id, values());
      await goalsRepo.replaceScopes(tx, a.ctx, id, [
        portfolioScope(p.id),
        { portfolioId: null, accountId: acc.id, subAccountId: sub.id },
      ]);
    });
    const stored = await withPool(a.ctx, (tx) => goalsRepo.find(tx, a.ctx, id));
    expect(stored).toMatchObject({
      name: 'Independência financeira',
      target: '500000.0000',
      monthly: '600.5000',
      rate: '6.000000',
      yield: null,
      deadline: '2040-01-01',
    });
    const scopes = await withPool(a.ctx, (tx) => goalsRepo.listScopes(tx, a.ctx, [id]));
    expect(scopes).toHaveLength(2);

    const updated = await withPool(a.ctx, (tx) =>
      goalsRepo.update(tx, a.ctx, id, values({ name: 'Fundo universitário', mode: 'none' })),
    );
    expect(updated).toMatchObject({ name: 'Fundo universitário', mode: 'none' });
    await withPool(a.ctx, (tx) => goalsRepo.replaceScopes(tx, a.ctx, id, []));
    expect(await withPool(a.ctx, (tx) => goalsRepo.listScopes(tx, a.ctx))).toEqual([]);

    expect(await withPool(a.ctx, (tx) => goalsRepo.remove(tx, a.ctx, id))).toBe(true);
    expect(await withPool(a.ctx, (tx) => goalsRepo.find(tx, a.ctx, id))).toBeUndefined();
  });

  it('deleting the goal, the portfolio or the sub-account removes the scope', async () => {
    const { a } = createTwoPools();
    const goalId = newId();
    const { p, acc, sub } = await withPool(a.ctx, async (tx) => {
      const p = await portfolio(tx, a.ctx);
      const acc = await account(tx, a.ctx);
      const sub = await subAccountsRepo.insert(tx, a.ctx, acc.id, newId(), {
        name: 'Simão',
        holderId: null,
      });
      await goalsRepo.insert(tx, a.ctx, goalId, values());
      await goalsRepo.replaceScopes(tx, a.ctx, goalId, [
        portfolioScope(p.id),
        { portfolioId: null, accountId: acc.id, subAccountId: sub.id },
      ]);
      return { p, acc, sub };
    });
    await withPool(a.ctx, (tx) => portfoliosRepo.remove(tx, a.ctx, p.id));
    expect(await withPool(a.ctx, (tx) => goalsRepo.listScopes(tx, a.ctx))).toHaveLength(1);
    await withPool(a.ctx, (tx) => subAccountsRepo.remove(tx, a.ctx, acc.id, sub.id));
    expect(await withPool(a.ctx, (tx) => goalsRepo.listScopes(tx, a.ctx))).toHaveLength(0);
    await withPool(a.ctx, (tx) =>
      goalsRepo.replaceScopes(tx, a.ctx, goalId, [
        { portfolioId: null, accountId: acc.id, subAccountId: null },
      ]),
    );
    await withPool(a.ctx, (tx) => goalsRepo.remove(tx, a.ctx, goalId));
    expect(await withPool(a.ctx, (tx) => goalsRepo.listScopes(tx, a.ctx))).toEqual([]);
  });

  it('refuses invalid rows with check constraints', async () => {
    const { a } = createTwoPools();
    const insert = (patch: Partial<GoalValues>) =>
      failureCodeOf(withPool(a.ctx, (tx) => goalsRepo.insert(tx, a.ctx, newId(), values(patch))));
    expect(await insert({ type: 'wealth' })).toBe(CHECK_VIOLATION);
    expect(await insert({ mode: 'later' })).toBe(CHECK_VIOLATION);
    expect(await insert({ target: '0' })).toBe(CHECK_VIOLATION);
    expect(await insert({ color: 'red' })).toBe(CHECK_VIOLATION);
    expect(await insert({ name: '' })).toBe(CHECK_VIOLATION);
    expect(await insert({ monthly: '-1' })).toBe(CHECK_VIOLATION);
    expect(await insert({ rate: '101' })).toBe(CHECK_VIOLATION);
    expect(await insert({ mode: 'date', deadline: null })).toBe(CHECK_VIOLATION);
    // Other modes need no deadline.
    await withPool(a.ctx, (tx) =>
      goalsRepo.insert(tx, a.ctx, newId(), values({ mode: 'eta', deadline: null })),
    );
  });

  it('a scope is a portfolio or an account, never both and never empty', async () => {
    const { a } = createTwoPools();
    const goalId = newId();
    const { p, acc } = await withPool(a.ctx, async (tx) => {
      await goalsRepo.insert(tx, a.ctx, goalId, values());
      return { p: await portfolio(tx, a.ctx), acc: await account(tx, a.ctx) };
    });
    const scope = (value: Parameters<typeof goalsRepo.replaceScopes>[3]) =>
      failureCodeOf(withPool(a.ctx, (tx) => goalsRepo.replaceScopes(tx, a.ctx, goalId, value)));
    expect(await scope([{ portfolioId: p.id, accountId: acc.id, subAccountId: null }])).toBe(
      CHECK_VIOLATION,
    );
    expect(await scope([{ portfolioId: null, accountId: null, subAccountId: null }])).toBe(
      CHECK_VIOLATION,
    );
  });

  it('stores an injection payload as plain text', async () => {
    const { a } = createTwoPools();
    for (const name of ["' OR 1=1 --", "'; DROP TABLE goals; --"]) {
      const id = newId();
      await withPool(a.ctx, (tx) => goalsRepo.insert(tx, a.ctx, id, values({ name })));
      expect((await withPool(a.ctx, (tx) => goalsRepo.find(tx, a.ctx, id)))?.name).toBe(name);
    }
    expect(await withPool(a.ctx, (tx) => goalsRepo.list(tx, a.ctx))).toHaveLength(2);
  });

  it('keeps money and rates exact', async () => {
    const { a } = createTwoPools();
    const id = newId();
    await withPool(a.ctx, (tx) =>
      goalsRepo.insert(tx, a.ctx, id, values({ target: '0.1', monthly: '0.2', yield: '3.5' })),
    );
    const row = await withPool(a.ctx, (tx) => goalsRepo.find(tx, a.ctx, id));
    expect(row).toMatchObject({ target: '0.1000', monthly: '0.2000', yield: '3.500000' });
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const p = await portfolio(tx, ctxB);
    const goalId = newId();
    await goalsRepo.insert(tx, ctxB, goalId, values({ name: 'pool B secret' }));
    await goalsRepo.replaceScopes(tx, ctxB, goalId, [portfolioScope(p.id)]);
    return { goalId, portfolioId: p.id };
  };
  const snapshot = async (tx: PoolTx, ctxB: PoolContext) => ({
    goals: await goalsRepo.list(tx, ctxB),
    scopes: await goalsRepo.listScopes(tx, ctxB),
  });
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('list finds nothing of pool B', () => check((tx, ctxA) => goalsRepo.list(tx, ctxA)));
  it('find finds nothing of pool B', () =>
    check((tx, ctxA, s) => goalsRepo.find(tx, ctxA, s.goalId)));
  it('listScopes finds nothing of pool B', () => {
    return check((tx, ctxA, s) => goalsRepo.listScopes(tx, ctxA, [s.goalId]));
  });
  it('update changes nothing of pool B', () =>
    check((tx, ctxA, s) => goalsRepo.update(tx, ctxA, s.goalId, values({ name: 'hijacked' }))));
  it('remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => goalsRepo.remove(tx, ctxA, s.goalId)));
  it('replaceScopes touches nothing of pool B', () =>
    check(async (tx, ctxA, s) => {
      // Pool B's goal is not A's: deleting finds nothing and the insert breaks the composite key.
      await goalsRepo.replaceScopes(tx, ctxA, s.goalId, []);
      return undefined;
    }));

  it('RLS: a raw select without the pool filter sees only the own pool', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, async (tx) => {
      await goalsRepo.insert(tx, a.ctx, newId(), values());
    });
    await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    const rows = await withPool(a.ctx, (tx) => tx.execute(sql`select pool_id from goals`));
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ pool_id: a.ctx.poolId });
  });

  it('RLS: pool A cannot write a goal or scope of pool B', async () => {
    const { a, b } = createTwoPools();
    const seeded = await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          tx.execute(
            sql`insert into goals (id, pool_id, name, color, type, target) values (${newId()}, ${b.ctx.poolId}, 'x', '#000000', 'value', 1)`,
          ),
        ),
      ),
    ).toBe(PG.rlsViolation);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          goalsRepo.replaceScopes(tx, a.ctx, newId(), [portfolioScope(seeded.portfolioId)]),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});
