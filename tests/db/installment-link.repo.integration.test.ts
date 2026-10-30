import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  loanEventsRepo,
  loansRepo,
  newId,
  transactionsRepo,
  type InstallmentValues,
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

const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

const loanValues = (accountId: string | null = null): LoanValues => ({
  name: 'Crédito',
  kind: 'mortgage',
  propertyId: null,
  principal: '111600',
  startDate: '2020-09-01',
  firstDueDate: '2020-10-05',
  termMonths: 480,
  rateType: 'fixed',
  rateIndex: null,
  spread: null,
  annualRate: '1.5',
  fixedUntil: null,
  reviewMonths: null,
  paymentDay: 5,
  debitAccountId: accountId,
  taeg: null,
  tan: null,
});

const installmentValues = (number = 1): InstallmentValues => ({
  number,
  dueDate: `2026-0${number}-05`,
  capital: '148.93',
  interest: '172.47',
  fees: '0',
  stampTax: '0',
  lifeInsurance: '40',
  homeInsurance: '27.17',
  creditInsurance: '0',
  status: 'paid',
  source: 'manual',
});

const makeAccount = async (tx: PoolTx, ctx: PoolContext) => {
  const id = newId();
  await accountsRepo.insert(tx, ctx, id, {
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
  return id;
};

const makeDebit = async (
  tx: PoolTx,
  ctx: PoolContext,
  accountId: string,
  patch: { date?: string; amount?: string; transfer?: boolean; description?: string } = {},
) => {
  const id = newId();
  await transactionsRepo.insert(tx, ctx, id, {
    accountId,
    date: patch.date ?? '2026-01-05',
    description: patch.description ?? 'PRESTACAO',
    amount: patch.amount ?? '-388.57',
    categoryId: null,
    transfer: patch.transfer ?? false,
    transferLocked: false,
    manualCategory: false,
    hash: `h-${id}`,
  });
  return id;
};

const makeLoan = async (tx: PoolTx, ctx: PoolContext, accountId: string | null = null) => {
  const loanId = newId();
  const installmentId = newId();
  await loansRepo.insert(tx, ctx, loanId, loanValues(accountId));
  await loansRepo.insertInstallment(tx, ctx, loanId, installmentId, installmentValues());
  return { loanId, installmentId };
};

describe('linking a debit to an installment', () => {
  it('links, finds, lists as linked and unlinks', async () => {
    const { a } = createTwoPools();
    const { installmentId } = await withPool(a.ctx, (tx) => makeLoan(tx, a.ctx));
    const debit = await withPool(a.ctx, async (tx) =>
      makeDebit(tx, a.ctx, await makeAccount(tx, a.ctx)),
    );
    expect(
      await withPool(a.ctx, (tx) =>
        transactionsRepo.setLoanInstallment(tx, a.ctx, debit, installmentId),
      ),
    ).toBe(true);
    expect(
      await withPool(a.ctx, (tx) => transactionsRepo.findByInstallment(tx, a.ctx, installmentId)),
    ).toEqual({ id: debit });
    expect(
      await withPool(a.ctx, (tx) =>
        transactionsRepo.linkedInstallmentIds(tx, a.ctx, [installmentId, newId()]),
      ),
    ).toEqual(new Set([installmentId]));
    const engine = await withPool(a.ctx, (tx) => transactionsRepo.listForEngine(tx, a.ctx));
    expect(engine[0]?.loanInstallmentId).toBe(installmentId);
    await withPool(a.ctx, (tx) => transactionsRepo.setLoanInstallment(tx, a.ctx, debit, null));
    expect(
      await withPool(a.ctx, (tx) => transactionsRepo.findByInstallment(tx, a.ctx, installmentId)),
    ).toBeUndefined();
    expect(
      await withPool(a.ctx, (tx) => transactionsRepo.linkedInstallmentIds(tx, a.ctx, [])),
    ).toEqual(new Set());
  });

  it('an installment takes one debit only', async () => {
    const { a } = createTwoPools();
    const { installmentId } = await withPool(a.ctx, (tx) => makeLoan(tx, a.ctx));
    const [first, second] = await withPool(a.ctx, async (tx) => {
      const account = await makeAccount(tx, a.ctx);
      return [await makeDebit(tx, a.ctx, account), await makeDebit(tx, a.ctx, account)] as const;
    });
    await withPool(a.ctx, (tx) =>
      transactionsRepo.setLoanInstallment(tx, a.ctx, first, installmentId),
    );
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          transactionsRepo.setLoanInstallment(tx, a.ctx, second, installmentId),
        ),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });

  it('deleting the installment keeps the debit, unlinked', async () => {
    const { a } = createTwoPools();
    const { loanId, installmentId } = await withPool(a.ctx, (tx) => makeLoan(tx, a.ctx));
    const debit = await withPool(a.ctx, async (tx) =>
      makeDebit(tx, a.ctx, await makeAccount(tx, a.ctx)),
    );
    await withPool(a.ctx, (tx) =>
      transactionsRepo.setLoanInstallment(tx, a.ctx, debit, installmentId),
    );
    await withPool(a.ctx, (tx) => loansRepo.removeInstallment(tx, a.ctx, loanId, installmentId));
    const rows = await withPool(a.ctx, (tx) => transactionsRepo.listForEngine(tx, a.ctx));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.loanInstallmentId).toBeNull();
  });

  it('a debit cannot point at an installment of another pool', async () => {
    const { a, b } = createTwoPools();
    const { installmentId } = await withPool(b.ctx, (tx) => makeLoan(tx, b.ctx));
    const debit = await withPool(a.ctx, async (tx) =>
      makeDebit(tx, a.ctx, await makeAccount(tx, a.ctx)),
    );
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          transactionsRepo.setLoanInstallment(tx, a.ctx, debit, installmentId),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe('the candidate debits', () => {
  it('lists only debits of the account, in the window, that are not transfers and are not linked', async () => {
    const { a } = createTwoPools();
    const { installmentId, account, debits } = await withPool(a.ctx, async (tx) => {
      const own = await makeAccount(tx, a.ctx);
      const other = await makeAccount(tx, a.ctx);
      const { installmentId: installment } = await makeLoan(tx, a.ctx, own);
      const inside = await makeDebit(tx, a.ctx, own, { date: '2026-01-04' });
      const linked = await makeDebit(tx, a.ctx, own, { date: '2026-01-05' });
      await transactionsRepo.setLoanInstallment(tx, a.ctx, linked, installment);
      await makeDebit(tx, a.ctx, own, { date: '2026-01-05', transfer: true });
      await makeDebit(tx, a.ctx, own, { date: '2026-01-05', amount: '388.57' });
      await makeDebit(tx, a.ctx, own, { date: '2026-02-20' });
      await makeDebit(tx, a.ctx, other, { date: '2026-01-05' });
      return { installmentId: installment, account: own, debits: [inside] };
    });
    expect(installmentId).toBeDefined();
    const found = await withPool(a.ctx, (tx) =>
      transactionsRepo.listUnlinkedDebits(tx, a.ctx, account, '2026-01-01', '2026-01-31'),
    );
    expect(found.map((row) => row.id)).toEqual(debits);
  });
});

describe('prepayments and installments of the pool', () => {
  it('lists every installment and every prepayment with its amount', async () => {
    const { a } = createTwoPools();
    const { loanId } = await withPool(a.ctx, (tx) => makeLoan(tx, a.ctx));
    await withPool(a.ctx, (tx) =>
      loansRepo.insertInstallment(tx, a.ctx, loanId, newId(), installmentValues(2)),
    );
    await withPool(a.ctx, (tx) =>
      tx.execute(
        sql`insert into loan_events (id, pool_id, loan_id, kind, date, effective_from, amount, effect)
            values (${newId()}, ${a.ctx.poolId}, ${loanId}, 'prepayment', '2026-03-01', '2026-03-01', 5000, 'reduce_term')`,
      ),
    );
    const installments = await withPool(a.ctx, (tx) => loansRepo.listAllInstallments(tx, a.ctx));
    expect(installments.map((row) => row.number)).toEqual([1, 2]);
    const prepaid = await withPool(a.ctx, (tx) => loanEventsRepo.listPrepayments(tx, a.ctx));
    expect(prepaid).toEqual([{ loanId, date: '2026-03-01', amount: '5000.0000' }]);
  });
});

describe('injection payloads and isolation', () => {
  it.each([`' OR 1=1 --`, `'; DROP TABLE transactions; --`])(
    'a hostile %j id is refused as a uuid and breaks nothing',
    async (payload) => {
      const { a } = createTwoPools();
      await withPool(a.ctx, async (tx) => makeDebit(tx, a.ctx, await makeAccount(tx, a.ctx)));
      expect(
        await failureCodeOf(
          withPool(a.ctx, (tx) => transactionsRepo.findByInstallment(tx, a.ctx, payload)),
        ),
      ).toBe(PG.invalidText);
      expect(
        await failureCodeOf(
          withPool(a.ctx, (tx) => transactionsRepo.setLoanInstallment(tx, a.ctx, payload, null)),
        ),
      ).toBe(PG.invalidText);
      expect(await withPool(a.ctx, (tx) => transactionsRepo.listForEngine(tx, a.ctx))).toHaveLength(
        1,
      );
    },
  );

  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const account = await makeAccount(tx, ctxB);
    const { loanId, installmentId } = await makeLoan(tx, ctxB, account);
    const debit = await makeDebit(tx, ctxB, account);
    await transactionsRepo.setLoanInstallment(tx, ctxB, debit, installmentId);
    const free = await makeDebit(tx, ctxB, account, { date: '2026-01-06' });
    return { account, loanId, installmentId, debit, free };
  };
  const snapshot = async (tx: PoolTx, ctxB: PoolContext) => ({
    transactions: await transactionsRepo.listForEngine(tx, ctxB),
    installments: await loansRepo.listAllInstallments(tx, ctxB),
  });
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('setLoanInstallment changes nothing of pool B', () =>
    check((tx, ctxA, s) => transactionsRepo.setLoanInstallment(tx, ctxA, s.free, null)));
  it('findByInstallment finds nothing of pool B', () =>
    check((tx, ctxA, s) => transactionsRepo.findByInstallment(tx, ctxA, s.installmentId)));
  it('linkedInstallmentIds finds nothing of pool B', () =>
    check(async (tx, ctxA, s) => [
      ...(await transactionsRepo.linkedInstallmentIds(tx, ctxA, [s.installmentId])),
    ]));
  it('listUnlinkedDebits finds nothing of pool B', () =>
    check((tx, ctxA, s) =>
      transactionsRepo.listUnlinkedDebits(tx, ctxA, s.account, '2026-01-01', '2026-12-31'),
    ));
  it('listAllInstallments finds nothing of pool B', () =>
    check((tx, ctxA) => loansRepo.listAllInstallments(tx, ctxA)));
  it('listPrepayments finds nothing of pool B', () =>
    check((tx, ctxA) => loanEventsRepo.listPrepayments(tx, ctxA)));
});
