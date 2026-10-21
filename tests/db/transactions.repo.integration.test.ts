import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  categoriesRepo,
  categoryRulesRepo,
  escapeLike,
  newId,
  transactionsRepo,
  type PoolContext,
  type PoolTx,
  type TransactionFilter,
  type TransactionValues,
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

const account = (tx: PoolTx, ctx: PoolContext, name = 'BPI') =>
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

const values = (
  accountId: string,
  overrides: Partial<TransactionValues> = {},
): TransactionValues => ({
  accountId,
  date: '2026-03-10',
  description: 'COMPRA CONTINENTE',
  amount: '-12.5',
  categoryId: null,
  transfer: false,
  transferLocked: false,
  manualCategory: false,
  hash: `h-${newId()}`,
  ...overrides,
});

const add = (
  tx: PoolTx,
  ctx: PoolContext,
  accountId: string,
  overrides: Partial<TransactionValues> = {},
) => transactionsRepo.insert(tx, ctx, newId(), values(accountId, overrides));

const page = (
  ctx: PoolContext,
  filter: TransactionFilter = {},
  sort: { by: 'date' | 'amount' | 'description'; descending: boolean } = {
    by: 'date',
    descending: true,
  },
  cursor: { value: string; id: string } | null = null,
  limit = 100,
) => withPool(ctx, (tx) => transactionsRepo.list(tx, ctx, filter, sort, cursor, limit));

describe('escapeLike', () => {
  it('escapes the characters LIKE gives a meaning to', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(escapeLike("' OR 1=1 --")).toBe("' OR 1=1 --");
  });
});

describe('transactions repository', () => {
  it('inserts, finds, updates and removes inside the pool, with exact decimals', async () => {
    const { a } = createTwoPools();
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    const id = newId();
    const created = await withPool(a.ctx, (tx) =>
      transactionsRepo.insert(tx, a.ctx, id, values(acc.id, { amount: '0.1' })),
    );
    expect(created).toMatchObject({ id, poolId: a.poolId, amount: '0.1000', transfer: false });
    expect((await withPool(a.ctx, (tx) => transactionsRepo.find(tx, a.ctx, id)))?.id).toBe(id);

    const updated = await withPool(a.ctx, (tx) =>
      transactionsRepo.update(tx, a.ctx, id, { transfer: true, transferLocked: true }),
    );
    expect(updated).toMatchObject({ transfer: true, transferLocked: true, amount: '0.1000' });
    expect(await withPool(a.ctx, (tx) => transactionsRepo.remove(tx, a.ctx, id))).toBe(true);
    expect(await withPool(a.ctx, (tx) => transactionsRepo.find(tx, a.ctx, id))).toBeUndefined();
  });

  it('keeps a hash unique inside an account, and the same hash may be used in another account', async () => {
    const { a } = createTwoPools();
    const [one, two] = await withPool(a.ctx, async (tx) => [
      await account(tx, a.ctx, 'um'),
      await account(tx, a.ctx, 'dois'),
    ]);
    await withPool(a.ctx, (tx) => add(tx, a.ctx, one.id, { hash: 'same' }));
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => add(tx, a.ctx, one.id, { hash: 'same' }))),
    ).toBe(UNIQUE_VIOLATION);
    await withPool(a.ctx, (tx) => add(tx, a.ctx, two.id, { hash: 'same' }));
  });

  it('refuses an account or a category the pool cannot use', async () => {
    const { a, b } = createTwoPools();
    const mine = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    const theirs = await withPool(b.ctx, (tx) => account(tx, b.ctx));
    const theirCategory = await withPool(b.ctx, (tx) =>
      categoriesRepo.insert(tx, b.ctx, newId(), {
        name: 'só da B',
        kind: 'expense',
        color: '#112233',
      }),
    );
    const [global] = await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx));
    // The composite foreign key stops an account of another pool even without RLS.
    expect(await failureCodeOf(withPool(a.ctx, (tx) => add(tx, a.ctx, theirs.id)))).toBe(
      FOREIGN_KEY_VIOLATION,
    );
    // The row policy stops a category of another pool, which a plain foreign key would accept.
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => add(tx, a.ctx, mine.id, { categoryId: theirCategory.id })),
      ),
    ).toBe(PG.rlsViolation);
    const ok = await withPool(a.ctx, (tx) =>
      add(tx, a.ctx, mine.id, { categoryId: global?.id ?? null }),
    );
    expect(ok.categoryId).toBe(global?.id);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          transactionsRepo.update(tx, a.ctx, ok.id, { categoryId: theirCategory.id }),
        ),
      ),
    ).toBe(PG.rlsViolation);
  });

  it('rejects an empty description, a too long note and a movement paired with itself', async () => {
    const { a } = createTwoPools();
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => add(tx, a.ctx, acc.id, { description: '' }))),
    ).toBe(CHECK_VIOLATION);
    const row = await withPool(a.ctx, (tx) => add(tx, a.ctx, acc.id));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => transactionsRepo.update(tx, a.ctx, row.id, { pairId: row.id })),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          tx.execute(sql`update transactions set note = ${'x'.repeat(2001)} where id = ${row.id}`),
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('pairs two movements and releases the partner of a deleted one', async () => {
    const { a } = createTwoPools();
    const [one, two] = await withPool(a.ctx, async (tx) => [
      await account(tx, a.ctx, 'um'),
      await account(tx, a.ctx, 'dois'),
    ]);
    const out = await withPool(a.ctx, (tx) => add(tx, a.ctx, one.id, { amount: '-50' }));
    const inn = await withPool(a.ctx, (tx) => add(tx, a.ctx, two.id, { amount: '50' }));
    const [global] = await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx));
    await withPool(a.ctx, (tx) =>
      transactionsRepo.pair(tx, a.ctx, {
        outflowId: out.id,
        inflowId: inn.id,
        categoryId: global?.id ?? null,
        setOutflowCategory: true,
        setInflowCategory: false,
      }),
    );
    const outAfter = await withPool(a.ctx, (tx) => transactionsRepo.find(tx, a.ctx, out.id));
    const inAfter = await withPool(a.ctx, (tx) => transactionsRepo.find(tx, a.ctx, inn.id));
    expect(outAfter).toMatchObject({ transfer: true, pairId: inn.id, categoryId: global?.id });
    expect(inAfter).toMatchObject({ transfer: true, pairId: out.id, categoryId: null });

    await withPool(a.ctx, async (tx) => {
      await transactionsRepo.unpairPartner(tx, a.ctx, out.id);
      await transactionsRepo.remove(tx, a.ctx, out.id);
    });
    expect(
      (await withPool(a.ctx, (tx) => transactionsRepo.find(tx, a.ctx, inn.id)))?.pairId,
    ).toBeNull();
  });

  it('applies changes in chunks: a new category, a transfer flag, and leaves null fields alone', async () => {
    const { a } = createTwoPools();
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    const [groceries, fuel] = (await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx))).slice(
      0,
      2,
    );
    const rows = await withPool(a.ctx, async (tx) => [
      await add(tx, a.ctx, acc.id, { categoryId: groceries?.id ?? null }),
      await add(tx, a.ctx, acc.id),
      await add(tx, a.ctx, acc.id, { transfer: true }),
    ]);
    const changed = await withPool(a.ctx, (tx) =>
      transactionsRepo.applyChanges(tx, a.ctx, [
        { id: rows[0]?.id ?? '', categoryId: fuel?.id ?? null, transfer: null },
        { id: rows[1]?.id ?? '', categoryId: null, transfer: true },
        { id: rows[2]?.id ?? '', categoryId: null, transfer: false },
      ]),
    );
    expect(changed).toBe(3);
    const read = (id: string | undefined) =>
      withPool(a.ctx, (tx) => transactionsRepo.find(tx, a.ctx, id ?? ''));
    expect(await read(rows[0]?.id)).toMatchObject({ categoryId: fuel?.id, transfer: false });
    expect(await read(rows[1]?.id)).toMatchObject({ categoryId: null, transfer: true });
    expect(await read(rows[2]?.id)).toMatchObject({ transfer: false });
    expect(await withPool(a.ctx, (tx) => transactionsRepo.applyChanges(tx, a.ctx, []))).toBe(0);
  });
});

describe('listing: filters, sort and cursor', () => {
  async function seedMovements() {
    const { a, b } = createTwoPools();
    const [one, two] = await withPool(a.ctx, async (tx) => [
      await account(tx, a.ctx, 'um'),
      await account(tx, a.ctx, 'dois'),
    ]);
    const categories = await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx));
    const byKey = (key: string) =>
      categories.find((category) => category.systemKey === key)?.id ?? null;
    await withPool(a.ctx, async (tx) => {
      await add(tx, a.ctx, one.id, {
        date: '2026-03-01',
        description: 'ORDENADO',
        amount: '1500',
        categoryId: byKey('salary'),
      });
      await add(tx, a.ctx, one.id, {
        date: '2026-03-05',
        description: 'COMPRA CONTINENTE',
        amount: '-40',
        categoryId: byKey('groceries'),
      });
      await add(tx, a.ctx, one.id, {
        date: '2026-03-05',
        description: 'PAGO 50% DESCONTO',
        amount: '-10',
      });
      await add(tx, a.ctx, two.id, { date: '2026-04-02', description: 'COMPRA_X', amount: '-5' });
      await add(tx, a.ctx, two.id, {
        date: '2026-04-03',
        description: 'TRF PARA POUPANCA',
        amount: '-100',
        transfer: true,
      });
      await add(tx, a.ctx, two.id, {
        date: '2026-04-03',
        description: 'REEMBOLSO',
        amount: '20',
        categoryId: byKey('refunds'),
      });
    });
    await withPool(a.ctx, (tx) =>
      tx.execute(sql`update transactions set note = 'lembrar' where description = 'ORDENADO'`),
    );
    return { a, b, one, two, byKey };
  }

  it('filters by month, account, category (or none), kind and notes', async () => {
    const { a, one, two, byKey } = await seedMovements();
    const names = async (filter: TransactionFilter) =>
      (await page(a.ctx, filter, { by: 'date', descending: false })).rows
        .map((row) => row.description)
        .sort();
    expect(await names({ from: '2026-04-01', to: '2026-04-30' })).toHaveLength(3);
    expect(await names({ accountId: one.id })).toHaveLength(3);
    expect(await names({ accountId: two.id, from: '2026-04-03', to: '2026-04-03' })).toEqual([
      'REEMBOLSO',
      'TRF PARA POUPANCA',
    ]);
    expect(await names({ categoryId: byKey('groceries') ?? '' })).toEqual(['COMPRA CONTINENTE']);
    expect(await names({ categoryId: 'none' })).toHaveLength(3);
    expect(await names({ kind: 'transfer' })).toEqual(['TRF PARA POUPANCA']);
    expect(await names({ kind: 'refund' })).toEqual(['REEMBOLSO']);
    expect(await names({ kind: 'income' })).toEqual(['ORDENADO']);
    // Without a category the sign decides: negative is an expense.
    expect(await names({ kind: 'expense' })).toEqual([
      'COMPRA CONTINENTE',
      'COMPRA_X',
      'PAGO 50% DESCONTO',
    ]);
    expect(await names({ withNotes: true })).toEqual(['ORDENADO']);
  });

  it('searches the text literally: %, _ and an injection payload are data', async () => {
    const { a } = await seedMovements();
    const found = async (text: string) =>
      (await page(a.ctx, { text })).rows.map((row) => row.description);
    expect(await found('continente')).toEqual(['COMPRA CONTINENTE']);
    expect(await found('50%')).toEqual(['PAGO 50% DESCONTO']);
    expect(await found('%')).toEqual(['PAGO 50% DESCONTO']);
    expect(await found('_')).toEqual(['COMPRA_X']);
    expect(await found('COMPRA_')).toEqual(['COMPRA_X']);
    expect(await found("' OR 1=1 --")).toEqual([]);
    expect(await found("'; DROP TABLE transactions; --")).toEqual([]);
  });

  it.each([
    ['date', true],
    ['date', false],
    ['amount', true],
    ['amount', false],
    ['description', true],
    ['description', false],
  ] as const)(
    'pages through everything by %s (descending: %s) without gaps or repeats',
    async (by, descending) => {
      const { a } = await seedMovements();
      const sort = { by, descending };
      const all = (await page(a.ctx, {}, sort, null, 100)).rows.map((row) => row.id);
      expect(all).toHaveLength(6);
      const seen: string[] = [];
      let cursor: { value: string; id: string } | null = null;
      for (let turn = 0; turn < 10; turn += 1) {
        const next = await page(a.ctx, {}, sort, cursor, 2);
        seen.push(...next.rows.map((row) => row.id));
        if (!next.next) break;
        cursor = next.next;
      }
      expect(seen).toEqual(all);
    },
  );
});

describe('totals', () => {
  const totalsOf = (ctx: PoolContext, filter: TransactionFilter = {}) =>
    withPool(ctx, (tx) => transactionsRepo.totals(tx, ctx, filter));

  it('sums per currency and kind, counts the uncategorized and skips the outflow of transfers', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, async (tx) => {
      const acc = await account(tx, a.ctx);
      await add(tx, a.ctx, acc.id, { amount: '-10.5' });
      await add(tx, a.ctx, acc.id, { amount: '-4.5' });
      await add(tx, a.ctx, acc.id, { amount: '100', date: '2026-04-01' });
      await add(tx, a.ctx, acc.id, { amount: '-20', transfer: true });
      await add(tx, a.ctx, acc.id, { amount: '20', transfer: true });
    });
    const all = await totalsOf(a.ctx);
    const by = (kind: string) => all.find((row) => row.kind === kind);
    expect(by('expense')).toMatchObject({ currency: 'EUR', total: '-15.0000', count: 2 });
    expect(by('expense')?.uncategorized).toBe(2);
    expect(by('income')).toMatchObject({ total: '100.0000', count: 1 });
    expect(by('transfer')).toMatchObject({ total: '20.0000', count: 2 });

    const march = await totalsOf(a.ctx, { from: '2026-03-01', to: '2026-03-31' });
    expect(march.find((row) => row.kind === 'income')).toBeUndefined();
    expect(await totalsOf(a.ctx, { kind: 'income' })).toHaveLength(1);
  });

  it('treats an injection payload in the text filter as data', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, async (tx) => {
      const acc = await account(tx, a.ctx);
      await add(tx, a.ctx, acc.id, { description: 'COMPRA' });
    });
    expect(await totalsOf(a.ctx, { text: "' OR 1=1 --" })).toEqual([]);
    expect(await totalsOf(a.ctx, { text: '%' })).toEqual([]);
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const acc = await account(tx, ctxB, 'pool B account');
    const row = await add(tx, ctxB, acc.id, { description: 'pool B secret' });
    const other = await add(tx, ctxB, acc.id, { description: 'pool B other', amount: '12.5' });
    const [category] = await categoriesRepo.list(tx, ctxB);
    const rule = await categoryRulesRepo.insert(tx, ctxB, newId(), {
      keyword: 'SEGREDO',
      categoryId: category?.id ?? '',
      accountId: null,
    });
    return { id: row.id, otherId: other.id, ruleId: rule.id, categoryId: category?.id ?? '' };
  };
  const snapshot = async (tx: PoolTx, ctxB: PoolContext) => ({
    rows: await transactionsRepo.listForEngine(tx, ctxB),
    rules: await categoryRulesRepo.list(tx, ctxB),
  });
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });
  const sorted = { by: 'date', descending: true } as const;

  it('transactions: list finds nothing of pool B', () =>
    check((tx, ctxA) =>
      transactionsRepo.list(tx, ctxA, {}, sorted, null, 50).then((result) => result.rows),
    ));
  it('transactions: list with a text and a cursor finds nothing of pool B', () =>
    check((tx, ctxA, s) =>
      transactionsRepo
        .list(tx, ctxA, { text: 'pool B' }, sorted, { value: '2999-01-01', id: s.id }, 50)
        .then((result) => result.rows),
    ));
  it('transactions: totals count nothing of pool B', () =>
    check((tx, ctxA) => transactionsRepo.totals(tx, ctxA, {})));
  it('transactions: find finds nothing of pool B', () =>
    check((tx, ctxA, s) => transactionsRepo.find(tx, ctxA, s.id)));
  it('transactions: update changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      transactionsRepo.update(tx, ctxA, s.id, { transfer: true, categoryId: s.categoryId }),
    ));
  it('transactions: remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => transactionsRepo.remove(tx, ctxA, s.id)));
  it('transactions: window finds nothing of pool B', () =>
    check((tx, ctxA) => transactionsRepo.window(tx, ctxA, '2000-01-01', '2999-12-31')));
  it('transactions: listForEngine finds nothing of pool B', () =>
    check((tx, ctxA) => transactionsRepo.listForEngine(tx, ctxA)));
  it('transactions: unpairPartner changes nothing of pool B', () =>
    check((tx, ctxA, s) => transactionsRepo.unpairPartner(tx, ctxA, s.id)));
  it('transactions: applyChanges changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      transactionsRepo.applyChanges(tx, ctxA, [
        { id: s.id, categoryId: s.categoryId, transfer: true },
      ]),
    ));
  it('transactions: pair changes nothing of pool B', () =>
    check(async (tx, ctxA, s) => {
      await transactionsRepo.pair(tx, ctxA, {
        outflowId: s.id,
        inflowId: s.otherId,
        categoryId: s.categoryId,
        setOutflowCategory: true,
        setInflowCategory: true,
      });
      return [];
    }));
  it('rules: list finds nothing of pool B', () =>
    check((tx, ctxA) => categoryRulesRepo.list(tx, ctxA)));
  it('rules: find finds nothing of pool B', () =>
    check((tx, ctxA, s) => categoryRulesRepo.find(tx, ctxA, s.ruleId)));
  it('rules: update changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      categoryRulesRepo.update(tx, ctxA, s.ruleId, {
        keyword: 'HIJACKED',
        categoryId: s.categoryId,
        accountId: null,
      }),
    ));
  it('rules: remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => categoryRulesRepo.remove(tx, ctxA, s.ruleId)));
  it('rules: reorder changes nothing of pool B', () =>
    check(async (tx, ctxA, s) => {
      await categoryRulesRepo.reorder(tx, ctxA, [s.ruleId]);
      return [];
    }));

  it('shows only the pool rows to a select without a where, and refuses a row for another pool', async () => {
    const { a, b } = createTwoPools();
    const accA = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    await withPool(a.ctx, (tx) => add(tx, a.ctx, accA.id));
    await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    const seen = await withPool(a.ctx, async (tx) => [
      ...(await tx.execute(sql`select pool_id from transactions`)).rows,
      ...(await tx.execute(sql`select pool_id from category_rules`)).rows,
    ]);
    expect(seen).toHaveLength(1);
    expect(seen.every((row) => row.pool_id === a.poolId)).toBe(true);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          tx.execute(
            sql`insert into transactions (id, pool_id, account_id, date, description, amount, hash) values (${newId()}, ${b.poolId}, ${accA.id}, '2026-01-01', 'x', 1, 'h')`,
          ),
        ),
      ),
    ).toBe(PG.rlsViolation);
  });

  it('sees nothing outside withPool', async () => {
    const { a } = createTwoPools();
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    await withPool(a.ctx, (tx) => add(tx, a.ctx, acc.id));
    expect((await database.app.pool.query('select * from transactions')).rows).toEqual([]);
    expect((await database.app.pool.query('select * from category_rules')).rows).toEqual([]);
  });
});

describe('category rules repository', () => {
  it('adds rules after the last, reorders them, and keeps the positions in sync', async () => {
    const { a } = createTwoPools();
    const [category] = await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx));
    const make = (keyword: string) =>
      withPool(a.ctx, (tx) =>
        categoryRulesRepo.insert(tx, a.ctx, newId(), {
          keyword,
          categoryId: category?.id ?? '',
          accountId: null,
        }),
      );
    const [first, second, third] = [
      await make('PRIMEIRA'),
      await make('SEGUNDA'),
      await make('TERCEIRA'),
    ];
    expect([first.position, second.position, third.position]).toEqual([1, 2, 3]);
    await withPool(a.ctx, (tx) =>
      categoryRulesRepo.reorder(tx, a.ctx, [third.id, first.id, second.id]),
    );
    const listed = await withPool(a.ctx, (tx) => categoryRulesRepo.list(tx, a.ctx));
    expect(listed.map((rule) => [rule.keyword, rule.position])).toEqual([
      ['TERCEIRA', 1],
      ['PRIMEIRA', 2],
      ['SEGUNDA', 3],
    ]);
  });

  it('refuses a category of another pool and cascades with its account', async () => {
    const { a, b } = createTwoPools();
    const theirs = await withPool(b.ctx, (tx) =>
      categoriesRepo.insert(tx, b.ctx, newId(), {
        name: 'só da B',
        kind: 'expense',
        color: '#112233',
      }),
    );
    const insert = (categoryId: string, accountId: string | null) =>
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          categoryRulesRepo.insert(tx, a.ctx, newId(), {
            keyword: 'REPSOL',
            categoryId,
            accountId,
          }),
        ),
      );
    expect(await insert(theirs.id, null)).toBe(PG.rlsViolation);
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    const [category] = await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx));
    await withPool(a.ctx, (tx) =>
      categoryRulesRepo.insert(tx, a.ctx, newId(), {
        keyword: 'REPSOL',
        categoryId: category?.id ?? '',
        accountId: acc.id,
      }),
    );
    await withPool(a.ctx, (tx) => accountsRepo.remove(tx, a.ctx, acc.id));
    expect(await withPool(a.ctx, (tx) => categoryRulesRepo.list(tx, a.ctx))).toEqual([]);
    expect(await insert(category?.id ?? '', null)).toBe('did-not-fail');
  });

  it('rejects a keyword that is too short and stores injection payloads literally', async () => {
    const { a } = createTwoPools();
    const [category] = await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx));
    const insert = (keyword: string) =>
      withPool(a.ctx, (tx) =>
        categoryRulesRepo.insert(tx, a.ctx, newId(), {
          keyword,
          categoryId: category?.id ?? '',
          accountId: null,
        }),
      );
    expect(await failureCodeOf(insert('x'))).toBe(CHECK_VIOLATION);
    const stored = await insert("'; DROP TABLE category_rules; --");
    expect(stored.keyword).toBe("'; DROP TABLE category_rules; --");
    expect(await withPool(a.ctx, (tx) => categoryRulesRepo.list(tx, a.ctx))).toHaveLength(1);
  });
});

describe('real counts replace the earlier stubs', () => {
  it('counts the movements of an account and the transactions and rules of a category', async () => {
    const { a } = createTwoPools();
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    const [category, other] = await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx));
    expect(await withPool(a.ctx, (tx) => accountsRepo.countReferences(tx, a.ctx, acc.id))).toBe(0);
    await withPool(a.ctx, async (tx) => {
      await add(tx, a.ctx, acc.id, { categoryId: category?.id ?? null });
      await add(tx, a.ctx, acc.id, { categoryId: category?.id ?? null });
      await categoryRulesRepo.insert(tx, a.ctx, newId(), {
        keyword: 'REPSOL',
        categoryId: category?.id ?? '',
        accountId: null,
      });
    });
    expect(await withPool(a.ctx, (tx) => accountsRepo.countReferences(tx, a.ctx, acc.id))).toBe(2);
    expect(
      await withPool(a.ctx, (tx) => categoriesRepo.countReferences(tx, a.ctx, category?.id ?? '')),
    ).toBe(3);
    await withPool(a.ctx, (tx) =>
      categoriesRepo.reassign(tx, a.ctx, category?.id ?? '', other?.id ?? ''),
    );
    expect(
      await withPool(a.ctx, (tx) => categoriesRepo.countReferences(tx, a.ctx, category?.id ?? '')),
    ).toBe(0);
    expect(
      await withPool(a.ctx, (tx) => categoriesRepo.countReferences(tx, a.ctx, other?.id ?? '')),
    ).toBe(3);
  });

  it('keeps the database from deleting an account or a category that is in use', async () => {
    const { a } = createTwoPools();
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    const own = await withPool(a.ctx, (tx) =>
      categoriesRepo.insert(tx, a.ctx, newId(), {
        name: 'Minha',
        kind: 'expense',
        color: '#112233',
      }),
    );
    await withPool(a.ctx, (tx) => add(tx, a.ctx, acc.id, { categoryId: own.id }));
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => accountsRepo.remove(tx, a.ctx, acc.id))),
    ).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => categoriesRepo.remove(tx, a.ctx, own.id))),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe('a list of 20 000 movements', () => {
  it('pages in under 150 ms per page, by date and with a filter', async () => {
    const { a } = createTwoPools();
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    await withPool(a.ctx, (tx) =>
      tx.execute(sql`
        insert into transactions (id, pool_id, account_id, date, description, amount, hash)
        select gen_random_uuid(), ${a.poolId}, ${acc.id},
               date '2020-01-01' + (n % 2000), 'MOVIMENTO ' || n, -(n % 500) - 0.5, 'perf-' || n
        from generate_series(1, 20000) as n
      `),
    );
    await withPool(a.ctx, (tx) => tx.execute(sql`analyze transactions`));
    const sort = { by: 'date', descending: true } as const;
    const timePage = async (
      filter: TransactionFilter,
      cursor: { value: string; id: string } | null,
    ) => {
      const started = performance.now();
      const result = await page(a.ctx, filter, sort, cursor, 50);
      return { ms: performance.now() - started, result };
    };
    await timePage({}, null); // warm-up: plan and cache
    const first = await timePage({}, null);
    expect(first.result.rows).toHaveLength(50);
    expect(first.ms).toBeLessThan(150);
    const deep = await timePage({}, first.result.next);
    expect(deep.result.rows).toHaveLength(50);
    expect(deep.ms).toBeLessThan(150);
    const filtered = await timePage({ from: '2022-01-01', to: '2022-12-31' }, null);
    expect(filtered.result.rows).toHaveLength(50);
    expect(filtered.ms).toBeLessThan(150);
  });
});
