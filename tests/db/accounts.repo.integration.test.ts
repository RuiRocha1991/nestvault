import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  holdersRepo,
  newId,
  subAccountsRepo,
  type AccountValues,
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
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

const values = (overrides: Partial<AccountValues> = {}): AccountValues => ({
  type: 'checking',
  name: 'BPI',
  institution: 'BPI',
  iban: null,
  currency: 'EUR',
  opening: '100.5',
  openingDate: '2026-01-01',
  trackCash: true,
  groupName: null,
  portfolioId: null,
  rate: null,
  xtbAccountNo: null,
  ...overrides,
});

const holder = (tx: PoolTx, ctx: PoolContext, name = 'Ana') =>
  holdersRepo.insert(tx, ctx, newId(), { name, color: '#9D6BFF', aliases: [], userId: null });

const account = (tx: PoolTx, ctx: PoolContext, overrides: Partial<AccountValues> = {}) =>
  accountsRepo.insert(tx, ctx, newId(), values(overrides));

describe('accounts repository', () => {
  it('inserts, finds, lists, updates and removes inside the pool, with exact decimals', async () => {
    const { a } = createTwoPools();
    const id = newId();
    const created = await withPool(a.ctx, (tx) =>
      accountsRepo.insert(tx, a.ctx, id, values({ opening: '0.1', rate: '2.5' })),
    );
    expect(created).toMatchObject({
      id,
      poolId: a.poolId,
      opening: '0.1000',
      rate: '2.500000',
      openingDate: '2026-01-01',
    });
    expect(await withPool(a.ctx, (tx) => accountsRepo.list(tx, a.ctx))).toHaveLength(1);
    expect((await withPool(a.ctx, (tx) => accountsRepo.find(tx, a.ctx, id)))?.id).toBe(id);

    const updated = await withPool(a.ctx, (tx) =>
      accountsRepo.update(tx, a.ctx, id, values({ name: 'Novo', opening: '0.2' })),
    );
    expect(updated).toMatchObject({ name: 'Novo', opening: '0.2000' });

    expect(await withPool(a.ctx, (tx) => accountsRepo.remove(tx, a.ctx, id))).toBe(true);
    expect(await withPool(a.ctx, (tx) => accountsRepo.find(tx, a.ctx, id))).toBeUndefined();
  });

  it('links holders, replaces them, and deleting the account takes links and sub-accounts along', async () => {
    const { a } = createTwoPools();
    const [ana, rui] = await withPool(a.ctx, async (tx) => [
      await holder(tx, a.ctx, 'Ana'),
      await holder(tx, a.ctx, 'Rui'),
    ]);
    const created = await withPool(a.ctx, (tx) => account(tx, a.ctx, { type: 'brokerage' }));
    await withPool(a.ctx, async (tx) => {
      await accountsRepo.setHolders(tx, a.ctx, created.id, [ana.id, rui.id]);
      await subAccountsRepo.insert(tx, a.ctx, created.id, newId(), {
        name: 'Ana',
        holderId: ana.id,
      });
    });
    expect(await withPool(a.ctx, (tx) => accountsRepo.listHolders(tx, a.ctx))).toHaveLength(2);

    await withPool(a.ctx, (tx) => accountsRepo.setHolders(tx, a.ctx, created.id, [rui.id]));
    expect(
      (await withPool(a.ctx, (tx) => accountsRepo.listHolders(tx, a.ctx, [created.id]))).map(
        (link) => link.holderId,
      ),
    ).toEqual([rui.id]);

    await withPool(a.ctx, (tx) => accountsRepo.remove(tx, a.ctx, created.id));
    expect(await withPool(a.ctx, (tx) => accountsRepo.listHolders(tx, a.ctx))).toEqual([]);
    expect(await withPool(a.ctx, (tx) => subAccountsRepo.list(tx, a.ctx))).toEqual([]);
  });

  it('counts the references of a holder (accounts that own it and sub-accounts that name it)', async () => {
    const { a } = createTwoPools();
    const ana = await withPool(a.ctx, (tx) => holder(tx, a.ctx));
    expect(await withPool(a.ctx, (tx) => holdersRepo.countReferences(tx, a.ctx, ana.id))).toBe(0);
    const created = await withPool(a.ctx, (tx) => account(tx, a.ctx, { type: 'brokerage' }));
    await withPool(a.ctx, async (tx) => {
      await accountsRepo.setHolders(tx, a.ctx, created.id, [ana.id]);
      await subAccountsRepo.insert(tx, a.ctx, created.id, newId(), {
        name: 'Ana',
        holderId: ana.id,
      });
    });
    expect(await withPool(a.ctx, (tx) => holdersRepo.countReferences(tx, a.ctx, ana.id))).toBe(2);
  });

  it('counts no movements until the tables exist (NES-44, NES-42, NES-40)', async () => {
    const { a } = createTwoPools();
    expect(await withPool(a.ctx, (tx) => accountsRepo.countReferences(tx, a.ctx, newId()))).toBe(0);
    expect(await withPool(a.ctx, (tx) => subAccountsRepo.countReferences(tx, a.ctx, newId()))).toBe(
      0,
    );
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const ana = await holder(tx, ctxB, 'pool B person');
    const created = await account(tx, ctxB, { name: 'pool B secret', type: 'brokerage' });
    await accountsRepo.setHolders(tx, ctxB, created.id, [ana.id]);
    const sub = await subAccountsRepo.insert(tx, ctxB, created.id, newId(), {
      name: 'pool B sub',
      holderId: ana.id,
    });
    return { id: created.id, subId: sub.id, holderId: ana.id };
  };
  const snapshot = async (tx: PoolTx, ctxB: PoolContext) => ({
    accounts: await accountsRepo.list(tx, ctxB),
    links: await accountsRepo.listHolders(tx, ctxB),
    subs: await subAccountsRepo.list(tx, ctxB),
  });
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('accounts: list finds nothing of pool B', () =>
    check((tx, ctxA) => accountsRepo.list(tx, ctxA)));
  it('accounts: find finds nothing of pool B', () =>
    check((tx, ctxA, s) => accountsRepo.find(tx, ctxA, s.id)));
  it('accounts: update changes nothing of pool B', () =>
    check((tx, ctxA, s) => accountsRepo.update(tx, ctxA, s.id, values({ name: 'hijacked' }))));
  it('accounts: remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => accountsRepo.remove(tx, ctxA, s.id)));
  it('account holders: list finds nothing of pool B', () =>
    check((tx, ctxA, s) => accountsRepo.listHolders(tx, ctxA, [s.id])));
  it('account holders: unfiltered list finds nothing of pool B', () =>
    check((tx, ctxA) => accountsRepo.listHolders(tx, ctxA)));
  it('sub-accounts: list finds nothing of pool B', () =>
    check((tx, ctxA) => subAccountsRepo.list(tx, ctxA)));
  it('sub-accounts: find finds nothing of pool B', () =>
    check((tx, ctxA, s) => subAccountsRepo.find(tx, ctxA, s.id, s.subId)));
  it('sub-accounts: update changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      subAccountsRepo.update(tx, ctxA, s.id, s.subId, { name: 'hijacked', holderId: null }),
    ));
  it('sub-accounts: remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => subAccountsRepo.remove(tx, ctxA, s.id, s.subId)));

  it('setHolders as pool A leaves the links of pool B alone and cannot link pool B’s account', async () => {
    const { a, b } = createTwoPools();
    const seeded = await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    const mine = await withPool(a.ctx, (tx) => holder(tx, a.ctx));
    const code = await failureCodeOf(
      withPool(a.ctx, (tx) => accountsRepo.setHolders(tx, a.ctx, seeded.id, [mine.id])),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
    expect(await withPool(b.ctx, (tx) => accountsRepo.listHolders(tx, b.ctx))).toHaveLength(1);
  });

  it('shows only the pool rows to a select without a where, and refuses a row for another pool', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => account(tx, a.ctx));
    await withPool(b.ctx, (tx) => account(tx, b.ctx, { name: 'B' }));
    const seen = await withPool(a.ctx, async (tx) => [
      ...(await tx.execute(sql`select pool_id from accounts`)).rows,
      ...(await tx.execute(sql`select pool_id from account_holders`)).rows,
      ...(await tx.execute(sql`select pool_id from sub_accounts`)).rows,
    ]);
    expect(seen).toHaveLength(1);
    expect(seen.every((row) => row.pool_id === a.poolId)).toBe(true);
    const code = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        tx.execute(
          sql`insert into accounts (id, pool_id, type, name, ccy) values (${newId()}, ${b.poolId}, 'checking', 'x', 'EUR')`,
        ),
      ),
    );
    expect(code).toBe(PG.rlsViolation);
  });

  it('sees nothing outside withPool', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => account(tx, a.ctx));
    for (const table of ['accounts', 'account_holders', 'sub_accounts']) {
      expect((await database.app.pool.query(`select * from ${table}`)).rows).toEqual([]);
    }
  });
});

describe('constraints', () => {
  it('stores SQL injection payloads in text fields literally', async () => {
    const { a } = createTwoPools();
    const payload = "'; DROP TABLE accounts; --";
    const created = await withPool(a.ctx, (tx) =>
      account(tx, a.ctx, {
        name: "' OR 1=1 --",
        institution: payload,
        groupName: payload,
        xtbAccountNo: payload,
      }),
    );
    const row = await withPool(a.ctx, (tx) => accountsRepo.find(tx, a.ctx, created.id));
    expect(row).toMatchObject({ name: "' OR 1=1 --", institution: payload, groupName: payload });
    expect(await withPool(a.ctx, (tx) => accountsRepo.list(tx, a.ctx))).toHaveLength(1);
  });

  it('keeps an IBAN unique inside a pool only, and rejects a badly formed one', async () => {
    const { a, b } = createTwoPools();
    const iban = 'PT50000201231234567890154';
    await withPool(a.ctx, (tx) => account(tx, a.ctx, { iban }));
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => account(tx, a.ctx, { iban, name: 'dup' }))),
    ).toBe(UNIQUE_VIOLATION);
    await withPool(b.ctx, (tx) => account(tx, b.ctx, { iban }));
    // Accounts without an IBAN never collide.
    await withPool(a.ctx, (tx) => account(tx, a.ctx, { name: 'sem iban 1' }));
    await withPool(a.ctx, (tx) => account(tx, a.ctx, { name: 'sem iban 2' }));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => account(tx, a.ctx, { iban: 'pt50 0002', name: 'bad' })),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('rejects an unknown type, an empty name, a bad currency, a foreign term deposit and a rate above 100', async () => {
    const { a } = createTwoPools();
    const insert = (overrides: Partial<AccountValues>) =>
      failureCodeOf(withPool(a.ctx, (tx) => account(tx, a.ctx, overrides)));
    expect(await insert({ type: 'crypto' })).toBe(CHECK_VIOLATION);
    expect(await insert({ name: '' })).toBe(CHECK_VIOLATION);
    expect(await insert({ currency: 'euro' })).toBe(CHECK_VIOLATION);
    expect(await insert({ type: 'term_deposit', currency: 'USD' })).toBe(CHECK_VIOLATION);
    expect(await insert({ rate: '101' })).toBe(CHECK_VIOLATION);
    await withPool(a.ctx, (tx) => account(tx, a.ctx, { type: 'term_deposit', currency: 'EUR' }));
  });

  it('refuses a holder of another pool and a duplicate sub-account name', async () => {
    const { a, b } = createTwoPools();
    const other = await withPool(b.ctx, (tx) => holder(tx, b.ctx));
    const mine = await withPool(a.ctx, (tx) => account(tx, a.ctx, { type: 'brokerage' }));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => accountsRepo.setHolders(tx, a.ctx, mine.id, [other.id])),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          subAccountsRepo.insert(tx, a.ctx, mine.id, newId(), { name: 'x', holderId: other.id }),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    await withPool(a.ctx, (tx) =>
      subAccountsRepo.insert(tx, a.ctx, mine.id, newId(), { name: 'Rui', holderId: null }),
    );
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          subAccountsRepo.insert(tx, a.ctx, mine.id, newId(), { name: 'Rui', holderId: null }),
        ),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });

  it('does not let a holder that owns an account be deleted at the database level', async () => {
    const { a } = createTwoPools();
    const ana = await withPool(a.ctx, (tx) => holder(tx, a.ctx));
    const created = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    await withPool(a.ctx, (tx) => accountsRepo.setHolders(tx, a.ctx, created.id, [ana.id]));
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => holdersRepo.remove(tx, a.ctx, ana.id))),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});
