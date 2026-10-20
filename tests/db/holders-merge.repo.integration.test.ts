import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { holdersRepo, newId, type HolderValues } from '@nestvault/db';

import { createTwoPools, openTestDatabase } from './harness';

const database = openTestDatabase(2);
const { withPool } = database;

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
});

const values = (overrides: Partial<HolderValues> = {}): HolderValues => ({
  name: 'Ana',
  color: '#9D6BFF',
  aliases: [],
  userId: null,
  ...overrides,
});

describe('holders repository: merge', () => {
  it('lists every table that references holders, so a new one cannot be forgotten by the merge', async () => {
    // `holdersRepo.merge` moves these. A table added later must be added there and here.
    const references = await database.asMigrator((pool) =>
      pool.query<{ table: string }>(
        `select distinct c.conrelid::regclass::text as "table"
           from pg_constraint c
          where c.contype = 'f' and c.confrelid = 'public.holders'::regclass
          order by 1`,
      ),
    );
    expect(references.rows.map((row) => row.table)).toEqual(['account_holders', 'sub_accounts']);
  });

  it('moves the aliases to the target and deletes the source', async () => {
    const { a } = createTwoPools();
    const [from, into] = [newId(), newId()];
    await withPool(a.ctx, async (tx) => {
      await holdersRepo.insert(tx, a.ctx, from, values({ name: 'Ana', aliases: ['ANA M'] }));
      await holdersRepo.insert(tx, a.ctx, into, values({ name: 'Beto' }));
      await holdersRepo.merge(tx, a.ctx, from, into, ['ANA M']);
    });
    expect(await withPool(a.ctx, (tx) => holdersRepo.find(tx, a.ctx, from))).toBeUndefined();
    expect(await withPool(a.ctx, (tx) => holdersRepo.find(tx, a.ctx, into))).toMatchObject({
      name: 'Beto',
      aliases: ['ANA M'],
    });
  });

  it('leaves everything unchanged when the transaction fails after the merge', async () => {
    const { a } = createTwoPools();
    const [from, into] = [newId(), newId()];
    await withPool(a.ctx, async (tx) => {
      await holdersRepo.insert(tx, a.ctx, from, values({ aliases: ['ANA M'] }));
      await holdersRepo.insert(tx, a.ctx, into, values({ name: 'Beto' }));
    });
    await expect(
      withPool(a.ctx, async (tx) => {
        await holdersRepo.merge(tx, a.ctx, from, into, ['ANA M']);
        throw new Error('fails halfway');
      }),
    ).rejects.toThrow('fails halfway');
    expect(await withPool(a.ctx, (tx) => holdersRepo.find(tx, a.ctx, from))).toMatchObject({
      aliases: ['ANA M'],
    });
    expect(await withPool(a.ctx, (tx) => holdersRepo.find(tx, a.ctx, into))).toMatchObject({
      aliases: [],
    });
  });

  it('touches nothing of pool B when called with the ids of pool B from pool A', async () => {
    const { a, b } = createTwoPools();
    const [from, into] = [newId(), newId()];
    await withPool(b.ctx, async (tx) => {
      await holdersRepo.insert(tx, b.ctx, from, values({ aliases: ['SECRET'] }));
      await holdersRepo.insert(tx, b.ctx, into, values({ name: 'Beto' }));
    });
    const before = await withPool(b.ctx, (tx) => holdersRepo.list(tx, b.ctx));
    await withPool(a.ctx, async (tx) => {
      expect(await holdersRepo.findForUpdate(tx, a.ctx, from)).toBeUndefined();
      expect(await holdersRepo.countMoves(tx, a.ctx, from)).toEqual({
        accounts: 0,
        subAccounts: 0,
      });
      await holdersRepo.merge(tx, a.ctx, from, into, ['HIJACK']);
    });
    expect(await withPool(b.ctx, (tx) => holdersRepo.list(tx, b.ctx))).toEqual(before);
  });

  it('stores injection payloads in the merged aliases literally', async () => {
    const { a } = createTwoPools();
    const [from, into] = [newId(), newId()];
    const payloads = ["' OR 1=1 --", "'; DROP TABLE HOLDERS; --"];
    await withPool(a.ctx, async (tx) => {
      await holdersRepo.insert(tx, a.ctx, from, values({ aliases: payloads }));
      await holdersRepo.insert(tx, a.ctx, into, values({ name: 'Beto' }));
      await holdersRepo.merge(tx, a.ctx, from, into, payloads);
    });
    expect(await withPool(a.ctx, (tx) => holdersRepo.list(tx, a.ctx))).toMatchObject([
      { id: into, aliases: payloads },
    ]);
  });
});
