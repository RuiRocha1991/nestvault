import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  loansRepo,
  newId,
  propertiesRepo,
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

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

// The reference mortgage of the owner's spreadsheet: 111 600 € over 480 months.
const values = (patch: Partial<LoanValues> = {}): LoanValues => ({
  name: 'Crédito habitação',
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
  debitAccountId: null,
  taeg: null,
  tan: null,
  ...patch,
});

const installment = (patch: Partial<InstallmentValues> = {}): InstallmentValues => ({
  number: 1,
  dueDate: '2020-10-05',
  capital: '300.5',
  interest: '139.5',
  fees: '0',
  stampTax: '0',
  lifeInsurance: '12.34',
  homeInsurance: '8.9',
  creditInsurance: '0',
  status: 'paid',
  source: 'manual',
  ...patch,
});

const field = (key: string, patch: object = {}) => ({
  id: newId(),
  key,
  label: key,
  kind: 'custom',
  enabled: true,
  countsAsExpense: true,
  defaultAmount: null,
  appliesFrom: null,
  ...patch,
});

describe('loans', () => {
  it('inserts, reads, updates and deletes a loan with fields, installments and custom amounts', async () => {
    const { a } = createTwoPools();
    const id = newId();
    const extra = field('condominium');
    const installmentId = newId();
    await withPool(a.ctx, async (tx) => {
      await loansRepo.insert(tx, a.ctx, id, values());
      await loansRepo.insertFields(tx, a.ctx, id, [extra]);
      await loansRepo.insertInstallment(tx, a.ctx, id, installmentId, installment());
      await loansRepo.replaceAmounts(tx, a.ctx, installmentId, [
        { fieldId: extra.id, amount: '15.25' },
      ]);
    });
    expect(await withPool(a.ctx, (tx) => loansRepo.find(tx, a.ctx, id))).toMatchObject({
      principal: '111600.0000',
      annualRate: '1.500000',
      termMonths: 480,
      startDate: '2020-09-01',
      firstDueDate: '2020-10-05',
    });
    expect(await withPool(a.ctx, (tx) => loansRepo.listInstallments(tx, a.ctx, id))).toEqual([
      expect.objectContaining({
        capital: '300.5000',
        interest: '139.5000',
        lifeInsurance: '12.3400',
      }),
    ]);
    expect(
      await withPool(a.ctx, (tx) => loansRepo.listAmounts(tx, a.ctx, [installmentId])),
    ).toEqual([expect.objectContaining({ fieldId: extra.id, amount: '15.2500' })]);

    const changed = await withPool(a.ctx, (tx) =>
      loansRepo.update(tx, a.ctx, id, values({ name: 'Novo nome', annualRate: '2' })),
    );
    expect(changed).toMatchObject({ name: 'Novo nome', annualRate: '2.000000' });

    // Replacing the custom amounts drops the old ones.
    await withPool(a.ctx, (tx) => loansRepo.replaceAmounts(tx, a.ctx, installmentId, []));
    expect(
      await withPool(a.ctx, (tx) => loansRepo.listAmounts(tx, a.ctx, [installmentId])),
    ).toEqual([]);

    expect(await withPool(a.ctx, (tx) => loansRepo.remove(tx, a.ctx, id))).toBe(true);
    // Fields and installments go with the loan.
    expect(await withPool(a.ctx, (tx) => loansRepo.listFields(tx, a.ctx))).toEqual([]);
    expect(await withPool(a.ctx, (tx) => loansRepo.listInstallments(tx, a.ctx, id))).toEqual([]);
  });

  it('refuses a second installment with the same number and negative amounts', async () => {
    const { a } = createTwoPools();
    const id = newId();
    await withPool(a.ctx, async (tx) => {
      await loansRepo.insert(tx, a.ctx, id, values());
      await loansRepo.insertInstallment(tx, a.ctx, id, newId(), installment());
    });
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => loansRepo.insertInstallment(tx, a.ctx, id, newId(), installment())),
      ),
    ).toBe(UNIQUE_VIOLATION);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          loansRepo.insertInstallment(
            tx,
            a.ctx,
            id,
            newId(),
            installment({ number: 2, interest: '-1' }),
          ),
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('refuses terms the check constraints forbid', async () => {
    const { a } = createTwoPools();
    for (const patch of [
      { principal: '0' },
      { termMonths: 0 },
      { termMonths: 601 },
      { paymentDay: 29 },
      { annualRate: '101' },
      { kind: 'boat' },
      { rateType: 'floating' },
      { rateIndex: 'libor' },
    ]) {
      expect(
        await failureCodeOf(
          withPool(a.ctx, (tx) => loansRepo.insert(tx, a.ctx, newId(), values(patch))),
        ),
      ).toBe(CHECK_VIOLATION);
    }
  });

  it('refuses a repeated field key and a badly formed one', async () => {
    const { a } = createTwoPools();
    const id = newId();
    await withPool(a.ctx, async (tx) => {
      await loansRepo.insert(tx, a.ctx, id, values());
      await loansRepo.insertFields(tx, a.ctx, id, [field('condominium')]);
    });
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => loansRepo.insertFields(tx, a.ctx, id, [field('condominium')])),
      ),
    ).toBe(UNIQUE_VIOLATION);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => loansRepo.insertFields(tx, a.ctx, id, [field(`x'; --`)])),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('keeps a disabled field and its values (only the flag changes)', async () => {
    const { a } = createTwoPools();
    const id = newId();
    const insurance = field('lifeInsurance', { kind: 'builtin' });
    await withPool(a.ctx, async (tx) => {
      await loansRepo.insert(tx, a.ctx, id, values());
      await loansRepo.insertFields(tx, a.ctx, id, [insurance]);
      await loansRepo.insertInstallment(tx, a.ctx, id, newId(), installment());
    });
    const updated = await withPool(a.ctx, (tx) =>
      loansRepo.updateField(tx, a.ctx, id, 'lifeInsurance', {
        label: 'Seguro de vida',
        enabled: false,
        countsAsExpense: true,
        defaultAmount: null,
        appliesFrom: null,
      }),
    );
    expect(updated).toMatchObject({ enabled: false, label: 'Seguro de vida' });
    expect(
      (await withPool(a.ctx, (tx) => loansRepo.listInstallments(tx, a.ctx, id)))[0],
    ).toMatchObject({ lifeInsurance: '12.3400' });
  });

  it('points at a property and an account of its own pool and blocks their deletion', async () => {
    const { a } = createTwoPools();
    const propertyId = newId();
    const accountId = newId();
    await withPool(a.ctx, async (tx) => {
      await propertiesRepo.insert(tx, a.ctx, propertyId, {
        name: 'Casa',
        type: 'primary_home',
        address: null,
        purchaseDate: '2020-09-01',
        purchasePrice: '124000',
        downPayment: '12400',
        deedCost: '0',
        imt: '0',
        stampDuty: '0',
        registrationCost: '0',
        bankFees: '0',
        sellingCostPct: null,
        includeInNetWorth: true,
      });
      await accountsRepo.insert(tx, a.ctx, accountId, {
        type: 'checking',
        name: 'Conta',
        institution: null,
        iban: null,
        currency: 'EUR',
        opening: '0',
        openingDate: '2020-01-01',
        trackCash: true,
        groupName: null,
        portfolioId: null,
        rate: null,
        xtbAccountNo: null,
      });
      await loansRepo.insert(tx, a.ctx, newId(), values({ propertyId, debitAccountId: accountId }));
    });
    expect(await withPool(a.ctx, (tx) => loansRepo.countForProperty(tx, a.ctx, propertyId))).toBe(
      1,
    );
    expect(await withPool(a.ctx, (tx) => loansRepo.countForAccount(tx, a.ctx, accountId))).toBe(1);
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => propertiesRepo.remove(tx, a.ctx, propertyId))),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe('injection payloads are data', () => {
  it.each([`' OR 1=1 --`, `'; DROP TABLE loans; --`])(
    'stores and reads back %j literally in every text field',
    async (payload) => {
      const { a } = createTwoPools();
      const id = newId();
      await withPool(a.ctx, async (tx) => {
        await loansRepo.insert(tx, a.ctx, id, values({ name: payload }));
        await loansRepo.insertFields(tx, a.ctx, id, [field('custom', { label: payload })]);
      });
      expect(await withPool(a.ctx, (tx) => loansRepo.find(tx, a.ctx, id))).toMatchObject({
        name: payload,
      });
      expect(await withPool(a.ctx, (tx) => loansRepo.listFields(tx, a.ctx, [id]))).toEqual([
        expect.objectContaining({ label: payload }),
      ]);
      expect(await withPool(a.ctx, (tx) => loansRepo.list(tx, a.ctx))).toHaveLength(1);
    },
  );

  it('a hostile id finds nothing and breaks nothing (refused as a uuid)', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => loansRepo.insert(tx, a.ctx, newId(), values()));
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => loansRepo.find(tx, a.ctx, `' OR 1=1 --`))),
    ).toBe(PG.invalidText);
    expect(await withPool(a.ctx, (tx) => loansRepo.list(tx, a.ctx))).toHaveLength(1);
  });

  it('a hostile field key is matched as data', async () => {
    const { a } = createTwoPools();
    const id = newId();
    await withPool(a.ctx, async (tx) => {
      await loansRepo.insert(tx, a.ctx, id, values());
      await loansRepo.insertFields(tx, a.ctx, id, [field('fees', { kind: 'builtin' })]);
    });
    expect(
      await withPool(a.ctx, (tx) =>
        loansRepo.updateField(tx, a.ctx, id, `fees' OR 1=1 --`, {
          label: 'x',
          enabled: false,
          countsAsExpense: true,
          defaultAmount: null,
          appliesFrom: null,
        }),
      ),
    ).toBeUndefined();
    expect((await withPool(a.ctx, (tx) => loansRepo.listFields(tx, a.ctx, [id])))[0]).toMatchObject(
      {
        enabled: true,
      },
    );
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const loanId = newId();
    const installmentId = newId();
    const extra = field('condominium');
    await loansRepo.insert(tx, ctxB, loanId, values({ name: 'pool B secret' }));
    await loansRepo.insertFields(tx, ctxB, loanId, [extra]);
    await loansRepo.insertInstallment(tx, ctxB, loanId, installmentId, installment());
    await loansRepo.replaceAmounts(tx, ctxB, installmentId, [{ fieldId: extra.id, amount: '9' }]);
    return { loanId, installmentId, fieldId: extra.id };
  };
  const snapshot = async (
    tx: PoolTx,
    ctxB: PoolContext,
    s: { loanId: string; installmentId: string },
  ) => ({
    loans: await loansRepo.list(tx, ctxB),
    fields: await loansRepo.listFields(tx, ctxB),
    installments: await loansRepo.listInstallments(tx, ctxB, s.loanId),
    amounts: await loansRepo.listAmounts(tx, ctxB, [s.installmentId]),
  });
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('list finds nothing of pool B', () => check((tx, ctxA) => loansRepo.list(tx, ctxA)));
  it('find finds nothing of pool B', () =>
    check((tx, ctxA, s) => loansRepo.find(tx, ctxA, s.loanId)));
  it('update changes nothing of pool B', () =>
    check((tx, ctxA, s) => loansRepo.update(tx, ctxA, s.loanId, values({ name: 'hijacked' }))));
  it('remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => loansRepo.remove(tx, ctxA, s.loanId)));
  it('countForProperty and countForAccount count nothing of pool B', () =>
    check(
      async (tx, ctxA, s) =>
        (await loansRepo.countForProperty(tx, ctxA, s.loanId)) +
        (await loansRepo.countForAccount(tx, ctxA, s.loanId)),
    ));
  it('listFields finds nothing of pool B', () =>
    check((tx, ctxA, s) => loansRepo.listFields(tx, ctxA, [s.loanId])));
  it('updateField changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      loansRepo.updateField(tx, ctxA, s.loanId, 'condominium', {
        label: 'hijacked',
        enabled: false,
        countsAsExpense: false,
        defaultAmount: null,
        appliesFrom: null,
      }),
    ));
  it('listInstallments finds nothing of pool B', () =>
    check((tx, ctxA, s) => loansRepo.listInstallments(tx, ctxA, s.loanId)));
  it('findInstallment finds nothing of pool B', () =>
    check((tx, ctxA, s) => loansRepo.findInstallment(tx, ctxA, s.loanId, s.installmentId)));
  it('updateInstallment changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      loansRepo.updateInstallment(
        tx,
        ctxA,
        s.loanId,
        s.installmentId,
        installment({ capital: '1' }),
      ),
    ));
  it('removeInstallment deletes nothing of pool B', () =>
    check((tx, ctxA, s) => loansRepo.removeInstallment(tx, ctxA, s.loanId, s.installmentId)));
  it('listAmounts finds nothing of pool B', () =>
    check((tx, ctxA, s) => loansRepo.listAmounts(tx, ctxA, [s.installmentId])));
  it('replaceAmounts touches nothing of pool B', () =>
    check(async (tx, ctxA, s) => {
      // B's installment is not A's: deleting finds nothing and the insert breaks the composite key.
      await loansRepo.replaceAmounts(tx, ctxA, s.installmentId, []);
      return undefined;
    }));

  it('RLS: a raw select without the pool filter sees only the own pool', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => loansRepo.insert(tx, a.ctx, newId(), values()));
    await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    for (const table of ['loans', 'loan_fields', 'loan_installments', 'loan_installment_amounts']) {
      const rows = await withPool(a.ctx, (tx) =>
        tx.execute(sql`select pool_id from ${sql.identifier(table)}`),
      );
      expect(rows.rows.every((row) => row['pool_id'] === a.ctx.poolId)).toBe(true);
    }
  });

  it('RLS and composite keys: pool A cannot write into pool B or point at its rows', async () => {
    const { a, b } = createTwoPools();
    const seeded = await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          tx.execute(
            sql`insert into loans (id, pool_id, name, kind, principal, start_date, first_due_date,
                  term_months, rate_type, annual_rate, payment_day)
                values (${newId()}, ${b.ctx.poolId}, 'x', 'car', 1, '2020-01-01', '2020-02-01',
                  12, 'fixed', 1, 1)`,
          ),
        ),
      ),
    ).toBe(PG.rlsViolation);
    // An installment cannot be added to B's loan through A's context.
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          loansRepo.insertInstallment(
            tx,
            a.ctx,
            seeded.loanId,
            newId(),
            installment({ number: 2 }),
          ),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});
