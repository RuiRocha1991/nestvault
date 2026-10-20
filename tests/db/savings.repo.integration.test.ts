import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  depositsRepo,
  interestEntriesRepo,
  newId,
  savingsProductsRepo,
  type DepositValues,
  type InterestEntryValues,
  type PoolContext,
  type PoolTx,
  type SavingsProductValues,
} from '@nestvault/db';

import { expectIsolated } from '../support/expect-isolated';

import { createTwoPools, failureCodeOf, openTestDatabase, pgErrorCode } from './harness';

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

const account = (tx: PoolTx, ctx: PoolContext, type = 'term_deposit', name = 'Depósito') =>
  accountsRepo.insert(tx, ctx, newId(), {
    type,
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

const productValues = (overrides: Partial<SavingsProductValues> = {}): SavingsProductValues => ({
  name: 'Depósito 12M',
  institution: 'Banco Alfa',
  rate: '2.5',
  payN: 3,
  payU: 'm',
  termN: 12,
  termU: 'm',
  tax: null,
  payToAccountId: null,
  fundFromAccountId: null,
  ...overrides,
});

const depositValues = (overrides: Partial<DepositValues> = {}): DepositValues => ({
  productId: null,
  capital: '10000',
  start: '2026-01-31',
  rate: '2.5',
  payN: 3,
  payU: 'm',
  termN: 12,
  termU: 'm',
  capitalize: false,
  tax: null,
  payToAccountId: null,
  fundFromAccountId: null,
  ...overrides,
});

const interestValues = (
  accountId: string,
  overrides: Partial<InterestEntryValues> = {},
): InterestEntryValues => ({
  accountId,
  date: '2026-02-01',
  amount: '12.34',
  note: null,
  ...overrides,
});

describe('savings products repository', () => {
  it('inserts, finds, lists, updates and removes inside the pool', async () => {
    const { a } = createTwoPools();
    const created = await withPool(a.ctx, (tx) =>
      savingsProductsRepo.insert(tx, a.ctx, newId(), productValues()),
    );
    expect(created).toMatchObject({ poolId: a.poolId, name: 'Depósito 12M', payN: 3, tax: null });
    expect(created.rate).toBe('2.500000');
    const updated = await withPool(a.ctx, (tx) =>
      savingsProductsRepo.update(
        tx,
        a.ctx,
        created.id,
        productValues({ rate: '3.1234', payN: null, payU: null, tax: '25' }),
      ),
    );
    expect(updated).toMatchObject({ rate: '3.123400', payN: null, tax: '25.000000' });
    expect(await withPool(a.ctx, (tx) => savingsProductsRepo.list(tx, a.ctx))).toHaveLength(1);
    expect(await withPool(a.ctx, (tx) => savingsProductsRepo.remove(tx, a.ctx, created.id))).toBe(
      true,
    );
    expect(await withPool(a.ctx, (tx) => savingsProductsRepo.find(tx, a.ctx, created.id))).toBe(
      undefined,
    );
  });

  it('enforces the ranges, the paired periods and the unique name', async () => {
    const { a } = createTwoPools();
    const insert = (overrides: Partial<SavingsProductValues>) =>
      withPool(a.ctx, (tx) =>
        savingsProductsRepo.insert(tx, a.ctx, newId(), productValues(overrides)),
      );
    await expect(failureCodeOf(insert({ rate: '100.5' }))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert({ rate: '-1' }))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert({ tax: '101' }))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert({ payU: null }))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert({ termN: null }))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert({ payU: 'y' }))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert({ payN: 0 }))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert({ name: '' }))).resolves.toBe(CHECK_VIOLATION);
    await insert({});
    await expect(failureCodeOf(insert({}))).resolves.toBe(UNIQUE_VIOLATION);
  });

  it('keeps the same name in two pools apart', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => savingsProductsRepo.insert(tx, a.ctx, newId(), productValues()));
    await withPool(b.ctx, (tx) => savingsProductsRepo.insert(tx, b.ctx, newId(), productValues()));
    expect(await withPool(b.ctx, (tx) => savingsProductsRepo.list(tx, b.ctx))).toHaveLength(1);
  });

  it('refuses an account of another pool and deleting an account a product names', async () => {
    const { a, b } = createTwoPools();
    const foreign = await withPool(b.ctx, (tx) => account(tx, b.ctx, 'savings', 'Beta'));
    await expect(
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          savingsProductsRepo.insert(
            tx,
            a.ctx,
            newId(),
            productValues({ payToAccountId: foreign.id }),
          ),
        ),
      ),
    ).resolves.toBe(FOREIGN_KEY_VIOLATION);

    const own = await withPool(a.ctx, (tx) => account(tx, a.ctx, 'savings', 'Poupança'));
    await withPool(a.ctx, (tx) =>
      savingsProductsRepo.insert(
        tx,
        a.ctx,
        newId(),
        productValues({ payToAccountId: own.id, fundFromAccountId: own.id }),
      ),
    );
    expect(
      await withPool(a.ctx, (tx) => savingsProductsRepo.countByAccount(tx, a.ctx, own.id)),
    ).toBe(1);
    await expect(
      failureCodeOf(withPool(a.ctx, (tx) => accountsRepo.remove(tx, a.ctx, own.id))),
    ).resolves.toBe(FOREIGN_KEY_VIOLATION);
  });

  it('treats injection payloads as data', async () => {
    const { a } = createTwoPools();
    for (const payload of ["' OR 1=1 --", "'; DROP TABLE savings_products; --"]) {
      const row = await withPool(a.ctx, (tx) =>
        savingsProductsRepo.insert(
          tx,
          a.ctx,
          newId(),
          productValues({ name: payload, institution: payload }),
        ),
      );
      const found = await withPool(a.ctx, (tx) => savingsProductsRepo.find(tx, a.ctx, row.id));
      expect(found).toMatchObject({ name: payload, institution: payload });
    }
    expect(await withPool(a.ctx, (tx) => savingsProductsRepo.list(tx, a.ctx))).toHaveLength(2);
    await expect(
      failureCodeOf(withPool(a.ctx, (tx) => savingsProductsRepo.find(tx, a.ctx, "' OR 1=1 --"))),
    ).resolves.toBe('22P02');
  });
});

describe('deposits repository', () => {
  const prepare = async (ctx: PoolContext) => {
    const acc = await withPool(ctx, (tx) => account(tx, ctx));
    const product = await withPool(ctx, (tx) =>
      savingsProductsRepo.insert(tx, ctx, newId(), productValues()),
    );
    return { acc, product };
  };

  it('inserts, finds, updates and removes; one deposit per account', async () => {
    const { a } = createTwoPools();
    const { acc, product } = await prepare(a.ctx);
    const created = await withPool(a.ctx, (tx) =>
      depositsRepo.insert(
        tx,
        a.ctx,
        newId(),
        acc.id,
        depositValues({ productId: product.id, capital: '10000.5' }),
      ),
    );
    expect(created).toMatchObject({
      poolId: a.poolId,
      accountId: acc.id,
      productId: product.id,
      capital: '10000.5000',
      start: '2026-01-31',
    });
    expect((await withPool(a.ctx, (tx) => depositsRepo.findByAccount(tx, a.ctx, acc.id)))?.id).toBe(
      created.id,
    );
    await expect(
      failureCodeOf(
        withPool(a.ctx, (tx) => depositsRepo.insert(tx, a.ctx, newId(), acc.id, depositValues())),
      ),
    ).resolves.toBe(UNIQUE_VIOLATION);
    const updated = await withPool(a.ctx, (tx) =>
      depositsRepo.update(tx, a.ctx, created.id, depositValues({ capitalize: true, tax: '20' })),
    );
    expect(updated).toMatchObject({ capitalize: true, tax: '20.000000', accountId: acc.id });
    expect(await withPool(a.ctx, (tx) => depositsRepo.countByProduct(tx, a.ctx, product.id))).toBe(
      0,
    );
    expect(await withPool(a.ctx, (tx) => depositsRepo.remove(tx, a.ctx, created.id))).toBe(true);
  });

  it('enforces capital, ranges and paired periods', async () => {
    const { a } = createTwoPools();
    const { acc } = await prepare(a.ctx);
    const insert = (overrides: Partial<DepositValues>) =>
      withPool(a.ctx, (tx) =>
        depositsRepo.insert(tx, a.ctx, newId(), acc.id, depositValues(overrides)),
      );
    await expect(failureCodeOf(insert({ capital: '0' }))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert({ rate: '100.0001' }))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert({ tax: '-1' }))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert({ payN: null }))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert({ termU: null }))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert({ termN: 0 }))).resolves.toBe(CHECK_VIOLATION);
  });

  it('removes the deposit with its account, and restricts the product and the funding accounts', async () => {
    const { a, b } = createTwoPools();
    const { acc, product } = await prepare(a.ctx);
    const funding = await withPool(a.ctx, (tx) => account(tx, a.ctx, 'checking', 'Ordem'));
    const created = await withPool(a.ctx, (tx) =>
      depositsRepo.insert(
        tx,
        a.ctx,
        newId(),
        acc.id,
        depositValues({ productId: product.id, payToAccountId: funding.id }),
      ),
    );
    expect(
      await withPool(a.ctx, (tx) => depositsRepo.countByFundingAccount(tx, a.ctx, funding.id)),
    ).toBe(1);
    await expect(
      failureCodeOf(withPool(a.ctx, (tx) => savingsProductsRepo.remove(tx, a.ctx, product.id))),
    ).resolves.toBe(FOREIGN_KEY_VIOLATION);
    await expect(
      failureCodeOf(withPool(a.ctx, (tx) => accountsRepo.remove(tx, a.ctx, funding.id))),
    ).resolves.toBe(FOREIGN_KEY_VIOLATION);
    expect(await withPool(a.ctx, (tx) => accountsRepo.countReferences(tx, a.ctx, funding.id))).toBe(
      1,
    );

    const foreign = await withPool(b.ctx, (tx) => account(tx, b.ctx, 'term_deposit', 'Beta'));
    await expect(
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          depositsRepo.insert(tx, a.ctx, newId(), foreign.id, depositValues()),
        ),
      ),
    ).resolves.toBe(FOREIGN_KEY_VIOLATION);

    await withPool(a.ctx, (tx) => accountsRepo.remove(tx, a.ctx, acc.id));
    expect(await withPool(a.ctx, (tx) => depositsRepo.find(tx, a.ctx, created.id))).toBe(undefined);
  });

  it('treats injection payloads in the ids and dates as data', async () => {
    const { a } = createTwoPools();
    const { acc } = await prepare(a.ctx);
    await withPool(a.ctx, (tx) => depositsRepo.insert(tx, a.ctx, newId(), acc.id, depositValues()));
    for (const payload of ["' OR 1=1 --", "'; DROP TABLE deposits; --"]) {
      await expect(
        failureCodeOf(withPool(a.ctx, (tx) => depositsRepo.find(tx, a.ctx, payload))),
      ).resolves.toBe('22P02');
    }
    expect(await withPool(a.ctx, (tx) => depositsRepo.list(tx, a.ctx))).toHaveLength(1);
  });
});

describe('interest entries repository', () => {
  it('inserts, lists newest first, filters by account, counts and removes', async () => {
    const { a } = createTwoPools();
    const one = await withPool(a.ctx, (tx) => account(tx, a.ctx, 'savings', 'Poupança 1'));
    const two = await withPool(a.ctx, (tx) => account(tx, a.ctx, 'savings', 'Poupança 2'));
    const first = await withPool(a.ctx, (tx) =>
      interestEntriesRepo.insert(tx, a.ctx, newId(), interestValues(one.id)),
    );
    await withPool(a.ctx, (tx) =>
      interestEntriesRepo.insert(
        tx,
        a.ctx,
        newId(),
        interestValues(one.id, { date: '2026-03-01', amount: '1.5' }),
      ),
    );
    await withPool(a.ctx, (tx) =>
      interestEntriesRepo.insert(tx, a.ctx, newId(), interestValues(two.id, { note: 'x' })),
    );
    const listed = await withPool(a.ctx, (tx) => interestEntriesRepo.list(tx, a.ctx, one.id));
    expect(listed.map((row) => row.date)).toEqual(['2026-03-01', '2026-02-01']);
    expect(listed[1]).toMatchObject({ amount: '12.3400', poolId: a.poolId });
    expect(await withPool(a.ctx, (tx) => interestEntriesRepo.list(tx, a.ctx))).toHaveLength(3);
    expect(
      await withPool(a.ctx, (tx) => interestEntriesRepo.countByAccount(tx, a.ctx, one.id)),
    ).toBe(2);
    expect(await withPool(a.ctx, (tx) => accountsRepo.countReferences(tx, a.ctx, one.id))).toBe(2);
    await expect(
      failureCodeOf(withPool(a.ctx, (tx) => accountsRepo.remove(tx, a.ctx, one.id))),
    ).resolves.toBe(FOREIGN_KEY_VIOLATION);
    expect(await withPool(a.ctx, (tx) => interestEntriesRepo.remove(tx, a.ctx, first.id))).toBe(
      true,
    );
    expect(await withPool(a.ctx, (tx) => interestEntriesRepo.find(tx, a.ctx, first.id))).toBe(
      undefined,
    );
  });

  it('enforces a positive amount and a short note, and refuses another pool’s account', async () => {
    const { a, b } = createTwoPools();
    const own = await withPool(a.ctx, (tx) => account(tx, a.ctx, 'savings'));
    const foreign = await withPool(b.ctx, (tx) => account(tx, b.ctx, 'savings', 'Beta'));
    const insert = (accountId: string, overrides: Partial<InterestEntryValues>) =>
      withPool(a.ctx, (tx) =>
        interestEntriesRepo.insert(tx, a.ctx, newId(), interestValues(accountId, overrides)),
      );
    await expect(failureCodeOf(insert(own.id, { amount: '0' }))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert(own.id, { note: 'x'.repeat(501) }))).resolves.toBe(
      CHECK_VIOLATION,
    );
    await expect(failureCodeOf(insert(foreign.id, {}))).resolves.toBe(FOREIGN_KEY_VIOLATION);
  });

  it('stores injection payloads in the note as data', async () => {
    const { a } = createTwoPools();
    const own = await withPool(a.ctx, (tx) => account(tx, a.ctx, 'savings'));
    for (const payload of ["' OR 1=1 --", "'; DROP TABLE interest_entries; --"]) {
      const row = await withPool(a.ctx, (tx) =>
        interestEntriesRepo.insert(tx, a.ctx, newId(), interestValues(own.id, { note: payload })),
      );
      expect(
        (await withPool(a.ctx, (tx) => interestEntriesRepo.find(tx, a.ctx, row.id)))?.note,
      ).toBe(payload);
    }
    expect(await withPool(a.ctx, (tx) => interestEntriesRepo.list(tx, a.ctx))).toHaveLength(2);
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const term = await account(tx, ctxB, 'term_deposit', 'Depósito B');
    const savings = await account(tx, ctxB, 'savings', 'Poupança B');
    const product = await savingsProductsRepo.insert(
      tx,
      ctxB,
      newId(),
      productValues({ name: 'Produto B', payToAccountId: savings.id }),
    );
    const deposit = await depositsRepo.insert(
      tx,
      ctxB,
      newId(),
      term.id,
      depositValues({ productId: product.id, payToAccountId: savings.id }),
    );
    const entry = await interestEntriesRepo.insert(
      tx,
      ctxB,
      newId(),
      interestValues(savings.id, { note: 'pool B secret' }),
    );
    return {
      termId: term.id,
      savingsId: savings.id,
      productId: product.id,
      depositId: deposit.id,
      entryId: entry.id,
    };
  };
  const snapshot = async (tx: PoolTx, ctxB: PoolContext) => ({
    products: await savingsProductsRepo.list(tx, ctxB),
    deposits: await depositsRepo.list(tx, ctxB),
    entries: await interestEntriesRepo.list(tx, ctxB),
  });
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('products: list finds nothing of pool B', () =>
    check((tx, ctxA) => savingsProductsRepo.list(tx, ctxA)));
  it('products: find finds nothing of pool B', () =>
    check((tx, ctxA, s) => savingsProductsRepo.find(tx, ctxA, s.productId)));
  it('products: update changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      savingsProductsRepo.update(tx, ctxA, s.productId, productValues({ name: 'hijacked' })),
    ));
  it('products: remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => savingsProductsRepo.remove(tx, ctxA, s.productId)));
  it('products: countByAccount counts nothing of pool B', () =>
    check((tx, ctxA, s) => savingsProductsRepo.countByAccount(tx, ctxA, s.savingsId)));

  it('deposits: list finds nothing of pool B', () =>
    check((tx, ctxA) => depositsRepo.list(tx, ctxA)));
  it('deposits: find finds nothing of pool B', () =>
    check((tx, ctxA, s) => depositsRepo.find(tx, ctxA, s.depositId)));
  it('deposits: findByAccount finds nothing of pool B', () =>
    check((tx, ctxA, s) => depositsRepo.findByAccount(tx, ctxA, s.termId)));
  it('deposits: update changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      depositsRepo.update(tx, ctxA, s.depositId, depositValues({ capital: '1' })),
    ));
  it('deposits: remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => depositsRepo.remove(tx, ctxA, s.depositId)));
  it('deposits: countByProduct counts nothing of pool B', () =>
    check((tx, ctxA, s) => depositsRepo.countByProduct(tx, ctxA, s.productId)));
  it('deposits: countByFundingAccount counts nothing of pool B', () =>
    check((tx, ctxA, s) => depositsRepo.countByFundingAccount(tx, ctxA, s.savingsId)));
  it('deposits: insert refuses pool B’s account', () =>
    expectIsolated({
      database,
      seed,
      snapshot,
      outcome: 'rejects',
      refusal: (error) => pgErrorCode(error) === FOREIGN_KEY_VIOLATION,
      run: (tx, ctxA, s) => depositsRepo.insert(tx, ctxA, newId(), s.termId, depositValues()),
    }));

  it('interest: list finds nothing of pool B', () =>
    check((tx, ctxA) => interestEntriesRepo.list(tx, ctxA)));
  it('interest: list by account finds nothing of pool B', () =>
    check((tx, ctxA, s) => interestEntriesRepo.list(tx, ctxA, s.savingsId)));
  it('interest: find finds nothing of pool B', () =>
    check((tx, ctxA, s) => interestEntriesRepo.find(tx, ctxA, s.entryId)));
  it('interest: remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => interestEntriesRepo.remove(tx, ctxA, s.entryId)));
  it('interest: countByAccount counts nothing of pool B', () =>
    check((tx, ctxA, s) => interestEntriesRepo.countByAccount(tx, ctxA, s.savingsId)));
});
