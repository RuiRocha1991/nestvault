import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import {
  accountsRepo,
  createIdentityDatabase,
  lockPoolResource,
  newId,
  poolSubscriptionsRepo,
  portfoliosRepo,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';

import { createTwoPools, failureCodeOf, openTestDatabase, PG } from './harness';

const database = openTestDatabase(2);
const { withPool } = database;
const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 2);

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
  await identity.close();
});

const account = (tx: PoolTx, ctx: PoolContext, name: string) =>
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

const portfolio = (tx: PoolTx, ctx: PoolContext, name: string) =>
  portfoliosRepo.insert(tx, ctx, newId(), {
    name,
    color: '#112233',
    currency: 'EUR',
    note: null,
    targets: {},
  });

describe('counts used by the plan limits', () => {
  it('count only the pool’s own accounts and portfolios', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, async (tx) => {
      await account(tx, a.ctx, 'A1');
      await account(tx, a.ctx, 'A2');
      await portfolio(tx, a.ctx, 'P1');
    });
    await withPool(b.ctx, async (tx) => {
      await account(tx, b.ctx, 'B1');
    });
    expect(await withPool(a.ctx, (tx) => accountsRepo.count(tx, a.ctx))).toBe(2);
    expect(await withPool(a.ctx, (tx) => portfoliosRepo.count(tx, a.ctx))).toBe(1);
    expect(await withPool(b.ctx, (tx) => accountsRepo.count(tx, b.ctx))).toBe(1);
    expect(await withPool(b.ctx, (tx) => portfoliosRepo.count(tx, b.ctx))).toBe(0);
  });
});

describe('lockPoolResource', () => {
  it('takes the lock inside a transaction and treats the resource as data (injection payload)', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, async (tx) => {
      await lockPoolResource(tx, a.ctx.poolId, `'; DROP TABLE accounts; --`);
      await lockPoolResource(tx, a.ctx.poolId, `' OR 1=1 --`);
      await account(tx, a.ctx, 'A1');
    });
    expect(await withPool(a.ctx, (tx) => accountsRepo.count(tx, a.ctx))).toBe(1);
  });
});

describe('poolSubscriptionsRepo', () => {
  const makePool = async () => {
    const id = newId();
    await identity.db.execute(sql`insert into pools (id, name) values (${id}, 'Teste')`);
    return id;
  };

  it('finds nothing for a pool without a row (Free) and the row once there is one', async () => {
    const poolId = await makePool();
    try {
      expect(await poolSubscriptionsRepo.find(identity.db, poolId)).toBeUndefined();
      await identity.db.execute(
        sql`insert into pool_subscriptions (pool_id, plan, status) values (${poolId}, 'pro', 'active')`,
      );
      expect(await poolSubscriptionsRepo.find(identity.db, poolId)).toMatchObject({
        poolId,
        plan: 'pro',
        status: 'active',
      });
    } finally {
      await identity.db.execute(sql`delete from pools where id = ${poolId}`);
    }
  });

  it('treats a hostile id as data: it is refused as a uuid, nothing matches, the table stays', async () => {
    expect(await failureCodeOf(poolSubscriptionsRepo.find(identity.db, `' OR 1=1 --`))).toBe(
      PG.invalidText,
    );
    const [row] = (
      await identity.db.execute(sql`select count(*)::int as n from pool_subscriptions`)
    ).rows;
    expect(row?.['n']).toBeTypeOf('number');
  });

  it('refuses a plan or status outside the allowed values', async () => {
    const poolId = await makePool();
    try {
      for (const [plan, status] of [
        ['gold', 'active'],
        ['pro', 'frozen'],
      ] as const) {
        expect(
          await failureCodeOf(
            identity.db.execute(
              sql`insert into pool_subscriptions (pool_id, plan, status) values (${poolId}, ${plan}, ${status})`,
            ),
          ),
        ).toBe('23514');
      }
    } finally {
      await identity.db.execute(sql`delete from pools where id = ${poolId}`);
    }
  });

  it('goes away with its pool (cascade)', async () => {
    const poolId = await makePool();
    await identity.db.execute(
      sql`insert into pool_subscriptions (pool_id, plan) values (${poolId}, 'pro')`,
    );
    await identity.db.execute(sql`delete from pools where id = ${poolId}`);
    expect(await poolSubscriptionsRepo.find(identity.db, poolId)).toBeUndefined();
  });
});
