import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConflictError,
  createEntitlements,
  createLoansService,
  ForbiddenError,
  InstallmentLinkDto,
  logger,
  MatchResultDto,
  NotFoundError,
  OverviewDto,
  PlanLimitError,
  ValidationError,
  createOverviewService,
  type LoansService,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { rows } from '../support/auth-harness';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;
let billed: LoansService;

// A fixed "today": the reference month is 09/2026.
const TODAY = new Date('2026-10-21T12:00:00Z');

beforeAll(async () => {
  logger.level = 'silent';
  world = await createApiWorld();
  billed = createLoansService({
    auth: world.auth,
    identity: world.identity,
    entitlements: createEntitlements({ identity: world.identity, billingEnabled: true }),
    run: world.database.withPool,
    trustedProxyHops: 1,
  });
});

beforeEach(async () => {
  s = await world.newScenario();
});

afterAll(async () => {
  await world.close();
});

const ownerOf = (poolId: string): Persona => (poolId === s.poolA ? 'owner' : 'outsider');
const anyId = '0192f2c8-7a1e-7000-8000-000000000001';

const overview = async (as: Persona = 'owner', poolId = s.poolA) =>
  createOverviewService({
    auth: world.auth,
    identity: world.identity,
    run: world.database.withPool,
    now: () => TODAY,
  }).get(await s.as(as), poolId, { range: '6' });

const account = async (poolId = s.poolA) => {
  const headers = await s.as(ownerOf(poolId));
  const [holder] = (await world.holders.list(headers, poolId)).holders;
  return world.accounts.create(headers, poolId, {
    type: 'checking',
    name: 'Conta à ordem',
    currency: 'EUR',
    opening: '10000',
    openingDate: '2020-01-01',
    holderIds: [holder?.id ?? ''],
  });
};

const property = async (poolId = s.poolA) => {
  const headers = await s.as(ownerOf(poolId));
  const [holder] = (await world.holders.list(headers, poolId)).holders;
  const created = await world.properties.create(headers, poolId, {
    name: 'Casa',
    type: 'primary_home',
    purchaseDate: '2020-09-01',
    purchasePrice: '124000',
    holders: [{ holderId: holder?.id ?? '', sharePct: '100' }],
  });
  await world.properties.addValuation(headers, poolId, created.id, {
    date: '2026-06-01',
    value: '155000',
  });
  return created;
};

const loan = async (propertyId: string, accountId?: string, poolId = s.poolA) =>
  world.loans.create(await s.as(ownerOf(poolId)), poolId, {
    name: 'Crédito habitação',
    kind: 'mortgage',
    propertyId,
    principal: '111600',
    startDate: '2020-09-01',
    firstDueDate: '2020-10-05',
    termMonths: 480,
    rateType: 'fixed',
    annualRate: '1.5',
    paymentDay: 5,
    ...(accountId && { debitAccountId: accountId }),
  });

// The reference installment: 388,57 € = capital 148,93 + interest 172,47 + insurances 67,17.
const installment = async (loanId: string, number = 1, dueDate = '2026-09-05', poolId = s.poolA) =>
  world.loans.addInstallment(await s.as(ownerOf(poolId)), poolId, loanId, {
    number,
    dueDate,
    capital: '148.93',
    interest: '172.47',
    lifeInsurance: '40',
    homeInsurance: '27.17',
  });

const debit = async (
  accountId: string,
  date = '2026-09-05',
  amount = '-388.57',
  poolId = s.poolA,
) =>
  world.transactions.create(await s.as(ownerOf(poolId)), poolId, {
    accountId,
    date,
    description: 'PRESTACAO HABITACAO',
    amount,
  });

const setup = async () => {
  const bank = await account();
  const house = await property();
  const created = await loan(house.id, bank.id);
  const row = await installment(created.id);
  return { bank, house, loan: created, row };
};

describe('linking an installment to its bank debit', () => {
  it('links, answers with the split, and counts only 239,64 € of 388,57 € as an expense', async () => {
    const { bank, loan: created, row } = await setup();
    const movement = await debit(bank.id);
    const owner = await s.as('owner');
    const before = await world.months.review(owner, s.poolA, '2026-09');
    expect(before.expenses).toBe('388.57');
    expect(before.loanCapital).toBe('0');

    const link = await world.loans.linkInstallment(owner, s.poolA, created.id, row.id, {
      transactionId: movement.id,
    });
    expect(InstallmentLinkDto.parse(link)).toEqual(link);
    expect(link).toEqual({
      installmentId: row.id,
      transactionId: movement.id,
      split: { interest: '172.47', insurance: '67.17', capital: '148.93' },
    });

    const after = await world.months.review(owner, s.poolA, '2026-09');
    // Capital 148,93 € is excluded; interest 172,47 € and the insurances count.
    expect(after.expenses).toBe('239.64');
    expect(after.loanCapital).toBe('148.93');
    const byCategory = new Map(after.categories.map((c) => [c.categoryId, c.value]));
    const categories = (await world.categories.list(owner, s.poolA)).categories;
    const idOf = (key: string) => categories.find((c) => c.systemKey === key)?.id ?? '';
    expect(byCategory.get(idOf('mortgage-interest'))).toBe('172.47');
    expect(byCategory.get(idOf('insurance'))).toBe('67.17');
    // The movement itself is untouched.
    const stored = (await world.transactions.list(owner, s.poolA)).transactions.find(
      (entry) => entry.id === movement.id,
    );
    expect(stored).toMatchObject({ amount: '-388.57', description: 'PRESTACAO HABITACAO' });
  });

  it('unlinks: the whole debit is an expense again', async () => {
    const { bank, loan: created, row } = await setup();
    const movement = await debit(bank.id);
    const owner = await s.as('owner');
    await world.loans.linkInstallment(owner, s.poolA, created.id, row.id, {
      transactionId: movement.id,
    });
    await world.loans.unlinkInstallment(owner, s.poolA, created.id, row.id);
    const review = await world.months.review(owner, s.poolA, '2026-09');
    expect(review.expenses).toBe('388.57');
    expect(review.loanCapital).toBe('0');
    await expect(
      world.loans.unlinkInstallment(owner, s.poolA, created.id, row.id),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a second link (409), a movement that pays another installment (409) and a bad movement (400)', async () => {
    const { bank, loan: created, row } = await setup();
    const owner = await s.as('owner');
    const movement = await debit(bank.id);
    const link = (installmentId: string, transactionId: string) =>
      world.loans.linkInstallment(owner, s.poolA, created.id, installmentId, { transactionId });
    await link(row.id, movement.id);
    const other = await installment(created.id, 2, '2026-10-05');
    await expect(link(row.id, (await debit(bank.id)).id)).rejects.toBeInstanceOf(ConflictError);
    await expect(link(other.id, movement.id)).rejects.toBeInstanceOf(ConflictError);
    const credit = await debit(bank.id, '2026-10-05', '388.57');
    await expect(link(other.id, credit.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(link(other.id, anyId)).rejects.toBeInstanceOf(ValidationError);
    const foreignAccount = await account(s.poolB);
    const foreign = await debit(foreignAccount.id, '2026-10-05', '-388.57', s.poolB);
    await expect(link(other.id, foreign.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      world.loans.linkInstallment(owner, s.poolA, created.id, other.id, {
        transactionId: movement.id,
        poolId: s.poolB,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(link(anyId, movement.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('only owner and admin link, unlink and match (403); another pool gets 404', async () => {
    const { bank, loan: created, row } = await setup();
    const movement = await debit(bank.id);
    for (const as of ['member', 'viewer'] as const) {
      const headers = await s.as(as);
      await expect(
        world.loans.linkInstallment(headers, s.poolA, created.id, row.id, {
          transactionId: movement.id,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.loans.unlinkInstallment(headers, s.poolA, created.id, row.id),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.loans.matchInstallments(headers, s.poolA, created.id),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    const outsider = await s.as('outsider');
    await expect(
      world.loans.linkInstallment(outsider, s.poolA, created.id, row.id, {
        transactionId: movement.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Pool A's installment through pool B's own URL is a 404 as well.
    await expect(
      world.loans.unlinkInstallment(outsider, s.poolB, created.id, row.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a deleted installment leaves the debit as a plain expense', async () => {
    const { bank, loan: created, row } = await setup();
    const movement = await debit(bank.id);
    const owner = await s.as('owner');
    await world.loans.linkInstallment(owner, s.poolA, created.id, row.id, {
      transactionId: movement.id,
    });
    await world.loans.removeInstallment(owner, s.poolA, created.id, row.id);
    expect((await world.months.review(owner, s.poolA, '2026-09')).expenses).toBe('388.57');
  });
});

describe('matching installments automatically', () => {
  it('links by account, amount (± cents) and date (± 5 days), closest first', async () => {
    const { bank, loan: created, row } = await setup();
    const second = await installment(created.id, 2, '2026-10-05');
    const late = await debit(bank.id, '2026-09-08');
    const exact = await debit(bank.id, '2026-09-05');
    const cents = await debit(bank.id, '2026-10-04', '-388.60');
    await debit(bank.id, '2026-10-20', '-388.57');
    await debit(bank.id, '2026-09-05', '-12');
    const owner = await s.as('owner');
    const result = await world.loans.matchInstallments(owner, s.poolA, created.id);
    expect(MatchResultDto.parse(result)).toEqual(result);
    expect(result.matched).toEqual([
      { installmentId: row.id, transactionId: exact.id },
      { installmentId: second.id, transactionId: cents.id },
    ]);
    expect(late.id).not.toBe(exact.id);
    // A second run changes nothing: both installments are linked.
    expect((await world.loans.matchInstallments(owner, s.poolA, created.id)).matched).toEqual([]);
  });

  it('ignores transfers and debits of other accounts, and needs the debit account (400)', async () => {
    const { loan: created } = await setup();
    const other = await account();
    await debit(other.id);
    const owner = await s.as('owner');
    expect((await world.loans.matchInstallments(owner, s.poolA, created.id)).matched).toEqual([]);
    const house = await property();
    const bare = await loan(house.id);
    await expect(world.loans.matchInstallments(owner, s.poolA, bare.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(world.loans.matchInstallments(owner, s.poolA, anyId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('net worth with real estate', () => {
  it('is assets minus liabilities in the overview and in the monthly review, the same number', async () => {
    const { loan: created } = await setup();
    // Paid so far: installment 1 (capital 148,93 €) and a prepayment of 5 000 €.
    await world.loans.addEvent(await s.as('owner'), s.poolA, created.id, {
      kind: 'prepayment',
      date: '2026-05-01',
      amount: '5000',
      effect: 'reduce_term',
    });
    const data = OverviewDto.parse(await overview());
    // 155 000 € of property, 111 600 − 148,93 − 5 000 = 106 451,07 € still owed.
    expect(data.realEstate).toEqual({ value: '155000', liabilities: '106451.07' });
    // Cash 10 000 € + property − debt.
    expect(data.kpis.netWorth.value).toBe('58548.93');
    const review = await world.months.review(await s.as('owner'), s.poolA, '2026-09');
    expect(review.netWorthEnd).toBe('58548.93');
    expect(review.timeline.at(-1)?.netWorth).toBe(review.netWorthEnd);
    expect(data.evolution.total.at(-2)).toBe(review.netWorthEnd);
  });

  it('leaves a property that is not included out of net worth, with its loan', async () => {
    const owner = await s.as('owner');
    const { house } = await setup();
    await world.properties.update(owner, s.poolA, house.id, { includeInNetWorth: false });
    const data = await overview();
    expect(data.realEstate).toEqual({ value: '0', liabilities: '0' });
    expect(data.kpis.netWorth.value).toBe('10000');
  });

  it('shows no lines and no change for a pool without real estate (regression)', async () => {
    await account();
    const data = await overview();
    expect(data.realEstate).toBeNull();
    expect(data.kpis.netWorth.value).toBe('10000');
    const review = await world.months.review(await s.as('owner'), s.poolA, '2026-09');
    expect(review.loanCapital).toBe('0');
    expect(review.netWorthEnd).toBe('10000');
  });

  it('does not count the real estate of another pool', async () => {
    await account();
    await property(s.poolB);
    const data = await overview();
    expect(data.realEstate).toBeNull();
    expect(data.kpis.netWorth.value).toBe('10000');
  });
});

describe('plan and audit', () => {
  it('answers plan_limit on a Free pool for the three operations', async () => {
    const owner = await s.as('owner');
    const refused = async (promise: Promise<unknown>) => {
      const error = await promise.then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(PlanLimitError);
    };
    await refused(billed.linkInstallment(owner, s.poolA, anyId, anyId, { transactionId: anyId }));
    await refused(billed.unlinkInstallment(owner, s.poolA, anyId, anyId));
    await refused(billed.matchInstallments(owner, s.poolA, anyId));
  });

  it('records the changes without amounts or descriptions', async () => {
    const { bank, loan: created, row } = await setup();
    const movement = await debit(bank.id);
    const owner = await s.as('owner');
    await world.loans.linkInstallment(owner, s.poolA, created.id, row.id, {
      transactionId: movement.id,
    });
    await world.loans.unlinkInstallment(owner, s.poolA, created.id, row.id);
    await world.loans.matchInstallments(owner, s.poolA, created.id);
    const log = await rows<{ action: string; entry: string }>(
      world.identity,
      sql`select action, to_jsonb(audit_log)::text as entry from audit_log where action in ('loan.installment_linked', 'loan.installment_unlinked', 'loan.installments_matched') and target = ${created.id} order by at`,
    );
    expect(log.map((entry) => entry.action)).toEqual([
      'loan.installment_linked',
      'loan.installment_unlinked',
      'loan.installments_matched',
    ]);
    const text = JSON.stringify(log);
    for (const secret of ['388.57', '148.93', '172.47', 'PRESTACAO HABITACAO']) {
      expect(text).not.toContain(secret);
    }
  });
});
