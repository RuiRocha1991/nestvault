import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  loanEventsRepo,
  loansRepo,
  newId,
  type LoanEventValues,
  type LoanValues,
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

const loan: LoanValues = {
  name: 'Crédito habitação',
  kind: 'mortgage',
  propertyId: null,
  principal: '111600',
  startDate: '2020-09-01',
  firstDueDate: '2020-10-05',
  termMonths: 480,
  rateType: 'variable',
  rateIndex: 'euribor_6m',
  spread: '1.2',
  annualRate: '1.5',
  fixedUntil: null,
  reviewMonths: 6,
  paymentDay: 5,
  debitAccountId: null,
  taeg: null,
  tan: null,
};

const none: LoanEventValues = {
  kind: 'prepayment',
  date: '2023-02-01',
  effectiveFrom: '2023-03-01',
  amount: '15000',
  fee: '0',
  effect: 'reduce_installment',
  indexValue: null,
  spread: null,
  annualRate: null,
  newInstallment: null,
  termMonths: null,
};
const prepayment = (patch: Partial<LoanEventValues> = {}): LoanEventValues => ({
  ...none,
  ...patch,
});
const review = (patch: Partial<LoanEventValues> = {}): LoanEventValues => ({
  ...none,
  kind: 'rate_review',
  date: '2023-03-05',
  effectiveFrom: '2023-03-05',
  amount: null,
  fee: null,
  effect: null,
  indexValue: '3.512',
  spread: '1.2',
  annualRate: '4.712',
  ...patch,
});
const renegotiation = (patch: Partial<LoanEventValues> = {}): LoanEventValues => ({
  ...review(),
  kind: 'renegotiation',
  date: '2023-10-01',
  effectiveFrom: '2023-10-01',
  indexValue: null,
  annualRate: '3',
  termMonths: 300,
  ...patch,
});

const makeLoan = async (tx: PoolTx, ctx: PoolContext) => {
  const id = newId();
  await loansRepo.insert(tx, ctx, id, loan);
  return id;
};

describe('loan events', () => {
  it('stores the three kinds, lists them in the order they take effect and deletes one', async () => {
    const { a } = createTwoPools();
    const loanId = await withPool(a.ctx, (tx) => makeLoan(tx, a.ctx));
    const ids = [newId(), newId(), newId()];
    await withPool(a.ctx, async (tx) => {
      await loanEventsRepo.insert(tx, a.ctx, loanId, ids[0] ?? '', renegotiation());
      await loanEventsRepo.insert(tx, a.ctx, loanId, ids[1] ?? '', prepayment());
      await loanEventsRepo.insert(tx, a.ctx, loanId, ids[2] ?? '', review());
    });
    const list = await withPool(a.ctx, (tx) => loanEventsRepo.list(tx, a.ctx, loanId));
    expect(list.map((event) => event.kind)).toEqual(['prepayment', 'rate_review', 'renegotiation']);
    expect(list[0]).toMatchObject({
      amount: '15000.0000',
      fee: '0.0000',
      effect: 'reduce_installment',
    });
    expect(list[1]).toMatchObject({
      indexValue: '3.512000',
      spread: '1.200000',
      annualRate: '4.712000',
    });
    expect(list[2]).toMatchObject({ annualRate: '3.000000', termMonths: 300 });
    expect(
      await withPool(a.ctx, (tx) => loanEventsRepo.remove(tx, a.ctx, loanId, ids[1] ?? '')),
    ).toBe(true);
    expect(await withPool(a.ctx, (tx) => loanEventsRepo.list(tx, a.ctx, loanId))).toHaveLength(2);
  });

  it('keeps a negative index value exact', async () => {
    const { a } = createTwoPools();
    const loanId = await withPool(a.ctx, (tx) => makeLoan(tx, a.ctx));
    const id = newId();
    await withPool(a.ctx, (tx) =>
      loanEventsRepo.insert(tx, a.ctx, loanId, id, review({ indexValue: '-0.527364' })),
    );
    expect(
      (await withPool(a.ctx, (tx) => loanEventsRepo.find(tx, a.ctx, loanId, id)))?.indexValue,
    ).toBe('-0.527364');
  });

  it.each([
    ['a prepayment without an effect', prepayment({ effect: null })],
    ['a prepayment of zero', prepayment({ amount: '0' })],
    ['a prepayment with a rate', prepayment({ annualRate: '3' })],
    ['an unknown effect', prepayment({ effect: 'reduce_everything' })],
    ['a review without a rate', review({ annualRate: null })],
    ['a review with a term', review({ termMonths: 12 })],
    ['a review with an amount', review({ amount: '1', effect: 'reduce_term' })],
    ['a renegotiation that changes nothing', renegotiation({ annualRate: null, termMonths: null })],
    ['an unknown kind', prepayment({ kind: 'gift' })],
    ['an effective date before the event', review({ effectiveFrom: '2023-03-04' })],
    ['a negative fee', prepayment({ fee: '-1' })],
    ['a rate above 100', review({ annualRate: '101' })],
    ['a term of zero', renegotiation({ termMonths: 0 })],
    ['an installment of zero', review({ newInstallment: '0' })],
  ])('refuses %s (check constraint)', async (_name, values) => {
    const { a } = createTwoPools();
    const loanId = await withPool(a.ctx, (tx) => makeLoan(tx, a.ctx));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => loanEventsRepo.insert(tx, a.ctx, loanId, newId(), values)),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('goes with its loan and cannot point at a loan that is not there', async () => {
    const { a } = createTwoPools();
    const loanId = await withPool(a.ctx, (tx) => makeLoan(tx, a.ctx));
    await withPool(a.ctx, (tx) => loanEventsRepo.insert(tx, a.ctx, loanId, newId(), prepayment()));
    await withPool(a.ctx, (tx) => loansRepo.remove(tx, a.ctx, loanId));
    expect(await withPool(a.ctx, (tx) => loanEventsRepo.list(tx, a.ctx, loanId))).toEqual([]);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => loanEventsRepo.insert(tx, a.ctx, newId(), newId(), prepayment())),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe('injection payloads are data', () => {
  it.each([`' OR 1=1 --`, `'; DROP TABLE loan_events; --`])(
    'a hostile %j in kind or effect is refused by the checks, not run',
    async (payload) => {
      const { a } = createTwoPools();
      const loanId = await withPool(a.ctx, (tx) => makeLoan(tx, a.ctx));
      expect(
        await failureCodeOf(
          withPool(a.ctx, (tx) =>
            loanEventsRepo.insert(tx, a.ctx, loanId, newId(), prepayment({ effect: payload })),
          ),
        ),
      ).toBe(CHECK_VIOLATION);
      await withPool(a.ctx, (tx) =>
        loanEventsRepo.insert(tx, a.ctx, loanId, newId(), prepayment()),
      );
      expect(await withPool(a.ctx, (tx) => loanEventsRepo.list(tx, a.ctx, loanId))).toHaveLength(1);
    },
  );

  it('a hostile id finds nothing and breaks nothing (refused as a uuid)', async () => {
    const { a } = createTwoPools();
    const loanId = await withPool(a.ctx, (tx) => makeLoan(tx, a.ctx));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => loanEventsRepo.find(tx, a.ctx, loanId, `' OR 1=1 --`)),
      ),
    ).toBe(PG.invalidText);
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const loanId = await makeLoan(tx, ctxB);
    const eventId = newId();
    await loanEventsRepo.insert(tx, ctxB, loanId, eventId, prepayment({ amount: '654321' }));
    return { loanId, eventId };
  };
  const snapshot = (tx: PoolTx, ctxB: PoolContext, s: { loanId: string }) =>
    loanEventsRepo.list(tx, ctxB, s.loanId);
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('list finds nothing of pool B', () =>
    check((tx, ctxA, s) => loanEventsRepo.list(tx, ctxA, s.loanId)));
  it('find finds nothing of pool B', () =>
    check((tx, ctxA, s) => loanEventsRepo.find(tx, ctxA, s.loanId, s.eventId)));
  it('remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => loanEventsRepo.remove(tx, ctxA, s.loanId, s.eventId)));

  it('RLS: a raw select without the pool filter sees only the own pool', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, async (tx) => {
      const loanId = await makeLoan(tx, a.ctx);
      await loanEventsRepo.insert(tx, a.ctx, loanId, newId(), prepayment());
    });
    await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    const rows = await withPool(a.ctx, (tx) => tx.execute(sql`select pool_id from loan_events`));
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows.every((row) => row['pool_id'] === a.ctx.poolId)).toBe(true);
  });

  it('RLS and composite keys: pool A cannot write into pool B or onto its loans', async () => {
    const { a, b } = createTwoPools();
    const seeded = await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          tx.execute(
            sql`insert into loan_events (id, pool_id, loan_id, kind, date, effective_from, amount, effect)
                values (${newId()}, ${b.ctx.poolId}, ${seeded.loanId}, 'prepayment', '2023-02-01', '2023-03-01', 1, 'reduce_term')`,
          ),
        ),
      ),
    ).toBe(PG.rlsViolation);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          loanEventsRepo.insert(tx, a.ctx, seeded.loanId, newId(), prepayment()),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});
