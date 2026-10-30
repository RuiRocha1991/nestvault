import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { createAppDatabase, indexRatesRepo } from '@nestvault/db';
import { frenchPayment } from '@nestvault/domain';
import {
  ConflictError,
  createEntitlements,
  createLoansService,
  ForbiddenError,
  InstallmentDto,
  LoanDto,
  LoanListDto,
  EventDto,
  EventListDto,
  logger,
  NotFoundError,
  PlanLimitError,
  ReviewPreviewDto,
  ScheduleDto,
  UnauthorizedError,
  ValidationError,
  type LoansService,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { rows } from '../support/auth-harness';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;
// The world's service has billing off (every pool is Pro); this one has it on: a pool without a
// subscription is Free.
let billed: LoansService;

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

// The reference mortgage of the owner's spreadsheet: 111 600 € over 480 months (PRD).
const reference = (patch: object = {}) => ({
  name: 'Crédito habitação',
  kind: 'mortgage',
  principal: '111600',
  startDate: '2020-09-01',
  firstDueDate: '2020-10-05',
  termMonths: 480,
  rateType: 'fixed',
  annualRate: '1.5',
  paymentDay: 5,
  ...patch,
});
const create = async (as: Persona = 'owner', patch: object = {}, poolId = s.poolA) =>
  world.loans.create(await s.as(as), poolId, reference(patch));
const addInstallment = async (loanId: string, body: object, poolId = s.poolA) =>
  world.loans.addInstallment(await s.as(ownerOf(poolId)), poolId, loanId, body);
const subscribe = (plan: string) =>
  world.identity.db.execute(
    sql`insert into pool_subscriptions (pool_id, plan, status) values (${s.poolA}, ${plan}, 'active')`,
  );

describe('loans service', () => {
  it('creates a loan with the default fields and nothing paid yet', async () => {
    const created = await create();
    expect(LoanDto.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      principal: '111600.0000',
      termMonths: 480,
      outstanding: '111600',
      remainingInstallments: 480,
      paid: { count: 0, capital: '0', interest: '0', total: '0' },
    });
    const enabled = created.fields.filter((field) => field.enabled).map((field) => field.key);
    expect(enabled.sort()).toEqual(['homeInsurance', 'lifeInsurance']);
    expect(created.fields.map((field) => field.key).sort()).toEqual([
      'creditInsurance',
      'fees',
      'homeInsurance',
      'lifeInsurance',
      'stampTax',
    ]);
  });

  it('lets owner and admin write; refuses member and viewer (403); everybody reads', async () => {
    for (const as of ['owner', 'admin'] as const) await create(as);
    for (const as of ['member', 'viewer'] as const) {
      await expect(create(as)).rejects.toBeInstanceOf(ForbiddenError);
    }
    for (const as of ['owner', 'admin', 'member', 'viewer'] as const) {
      const list = await world.loans.list(await s.as(as), s.poolA);
      expect(LoanListDto.parse(list)).toEqual(list);
      expect(list.loans).toHaveLength(2);
    }
  });

  it('answers 401 without a session and 404 to a non-member', async () => {
    await expect(world.loans.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(world.loans.list(await s.as('outsider'), s.poolA)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.loans.create(await s.as('outsider'), s.poolA, reference()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('validates the terms (400): index for variable rates, fixed-until for mixed, strict body', async () => {
    const bad = (patch: object) => create('owner', patch);
    await expect(bad({ rateType: 'variable' })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ rateType: 'mixed', rateIndex: 'euribor_6m' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(bad({ firstDueDate: '2020-08-01' })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ principal: '0' })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ termMonths: 601 })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ annualRate: '1,5' })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ paymentDay: 31 })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ poolId: s.poolB })).rejects.toBeInstanceOf(ValidationError);
    const variable = await bad({
      rateType: 'variable',
      rateIndex: 'euribor_6m',
      spread: '-0.5',
      reviewMonths: 6,
    });
    expect(variable).toMatchObject({ rateIndex: 'euribor_6m', spread: '-0.500000' });
  });

  it('refuses a property or account of another pool (400)', async () => {
    const foreign = '0192f2c8-7a1e-7000-8000-000000000001';
    await expect(create('owner', { propertyId: foreign })).rejects.toBeInstanceOf(ValidationError);
    await expect(create('owner', { debitAccountId: foreign })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('changes only what the body says', async () => {
    const created = await create();
    const changed = await world.loans.update(await s.as('owner'), s.poolA, created.id, {
      name: 'Renomeado',
      annualRate: '2',
    });
    expect(changed).toMatchObject({ name: 'Renomeado', annualRate: '2.000000', termMonths: 480 });
    await expect(
      world.loans.update(await s.as('owner'), s.poolA, created.id, { rateType: 'mixed' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('answers 404 for another pool’s loan and for a malformed id', async () => {
    const other = await create('outsider', {}, s.poolB);
    const owner = await s.as('owner');
    await expect(world.loans.get(owner, s.poolA, other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.loans.update(owner, s.poolA, other.id, { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.loans.remove(owner, s.poolA, other.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(world.loans.schedule(owner, s.poolA, other.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(world.loans.get(owner, s.poolA, `' OR 1=1 --`)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await world.loans.get(await s.as('outsider'), s.poolB, other.id)).name).toBe(
      'Crédito habitação',
    );
  });

  it('deletes a loan with its installments', async () => {
    const created = await create();
    await addInstallment(created.id, {
      number: 1,
      dueDate: '2020-10-05',
      capital: '1',
      interest: '1',
    });
    await world.loans.remove(await s.as('owner'), s.poolA, created.id);
    await expect(world.loans.get(await s.as('owner'), s.poolA, created.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('installments', () => {
  it('adds up what was paid; a disabled field keeps its value but stops counting', async () => {
    const created = await create();
    const first = await addInstallment(created.id, {
      number: 1,
      dueDate: '2020-10-05',
      capital: '300.5',
      interest: '139.5',
      lifeInsurance: '12.34',
      homeInsurance: '8.9',
      creditInsurance: '5',
    });
    expect(InstallmentDto.parse(first)).toEqual(first);
    // creditInsurance is not enabled by default: 300.5 + 139.5 + 12.34 + 8.9.
    expect(first.total).toBe('461.24');
    expect((await world.loans.get(await s.as('owner'), s.poolA, created.id)).paid).toMatchObject({
      count: 1,
      capital: '300.5',
      interest: '139.5',
      total: '461.24',
      costOfCredit: '160.74',
    });

    await world.loans.updateField(await s.as('owner'), s.poolA, created.id, 'creditInsurance', {
      enabled: true,
    });
    const after = await world.loans.listInstallments(await s.as('owner'), s.poolA, created.id);
    expect(after.installments[0]).toMatchObject({ total: '466.24', creditInsurance: '5.0000' });

    await world.loans.updateField(await s.as('owner'), s.poolA, created.id, 'creditInsurance', {
      enabled: false,
    });
    const kept = await world.loans.listInstallments(await s.as('owner'), s.poolA, created.id);
    expect(kept.installments[0]).toMatchObject({ total: '461.24', creditInsurance: '5.0000' });
  });

  it('derives outstanding capital and installments left from what was entered', async () => {
    const created = await create();
    await addInstallment(created.id, {
      number: 1,
      dueDate: '2020-10-05',
      capital: '300',
      interest: '140',
    });
    await addInstallment(created.id, {
      number: 2,
      dueDate: '2020-11-05',
      capital: '301',
      interest: '139',
    });
    expect(await world.loans.get(await s.as('owner'), s.poolA, created.id)).toMatchObject({
      outstanding: '110999',
      remainingInstallments: 478,
    });
  });

  it('refuses a repeated number (409), one beyond the term and unknown custom keys (400)', async () => {
    const created = await create('owner', { termMonths: 12 });
    const body = { number: 1, dueDate: '2020-10-05', capital: '1', interest: '1' };
    await addInstallment(created.id, body);
    await expect(addInstallment(created.id, body)).rejects.toBeInstanceOf(ConflictError);
    await expect(addInstallment(created.id, { ...body, number: 13 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      addInstallment(created.id, { ...body, number: 2, custom: { nope: '1' } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      addInstallment(created.id, { ...body, number: 2, capital: '-1' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps custom-field amounts and counts them only while the field is enabled', async () => {
    const created = await create();
    const owner = await s.as('owner');
    const added = await world.loans.addField(owner, s.poolA, created.id, {
      key: 'condominium',
      label: 'Condomínio',
    });
    expect(added).toMatchObject({ key: 'condominium', kind: 'custom', enabled: true });
    await expect(
      world.loans.addField(owner, s.poolA, created.id, { key: 'condominium', label: 'Outra vez' }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      world.loans.addField(owner, s.poolA, created.id, { key: 'fees', label: 'Taxas' }),
    ).rejects.toBeInstanceOf(ValidationError);

    const installment = await addInstallment(created.id, {
      number: 1,
      dueDate: '2020-10-05',
      capital: '100',
      interest: '10',
      custom: { condominium: '15.25' },
    });
    expect(installment).toMatchObject({ custom: { condominium: '15.2500' }, total: '125.25' });
    await world.loans.updateField(owner, s.poolA, created.id, 'condominium', { enabled: false });
    const [kept] = (await world.loans.listInstallments(owner, s.poolA, created.id)).installments;
    expect(kept).toMatchObject({ custom: { condominium: '15.2500' }, total: '110' });
  });

  it('creates a custom field with its start date, optionally hidden from the start', async () => {
    const created = await create();
    const owner = await s.as('owner');
    const added = await world.loans.addField(owner, s.poolA, created.id, {
      key: 'paymentProtection',
      label: 'Seguro de proteção',
      defaultAmount: '12.5',
      appliesFrom: '2026-10-01',
      enabled: false,
      countsAsExpense: false,
    });
    expect(added).toMatchObject({
      key: 'paymentProtection',
      enabled: false,
      countsAsExpense: false,
      appliesFrom: '2026-10-01',
    });
    await expect(
      world.loans.addField(owner, s.poolA, created.id, {
        key: 'other',
        label: 'x',
        appliesFrom: 'tomorrow',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('corrects and deletes an installment, but not through another loan’s URL', async () => {
    const created = await create();
    const other = await create('owner', { name: 'Outro' });
    const owner = await s.as('owner');
    const row = await addInstallment(created.id, {
      number: 1,
      dueDate: '2020-10-05',
      capital: '300',
      interest: '140',
    });
    const changed = await world.loans.updateInstallment(owner, s.poolA, created.id, row.id, {
      interest: '141',
    });
    expect(changed).toMatchObject({ number: 1, capital: '300.0000', interest: '141.0000' });
    await expect(
      world.loans.updateInstallment(owner, s.poolA, other.id, row.id, { interest: '1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.loans.removeInstallment(owner, s.poolA, other.id, row.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await world.loans.removeInstallment(owner, s.poolA, created.id, row.id);
    expect((await world.loans.listInstallments(owner, s.poolA, created.id)).installments).toEqual(
      [],
    );
  });

  it('writes by member or viewer answer 403', async () => {
    const created = await create();
    for (const as of ['member', 'viewer'] as const) {
      await expect(
        world.loans.addInstallment(await s.as(as), s.poolA, created.id, {
          number: 1,
          dueDate: '2020-10-05',
          capital: '1',
          interest: '1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.loans.updateField(await s.as(as), s.poolA, created.id, 'fees', { enabled: true }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.loans.addField(await s.as(as), s.poolA, created.id, { key: 'extra', label: 'Extra' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('refuses a custom field key that is a property of the installment', async () => {
    const created = await create();
    const owner = await s.as('owner');
    for (const key of ['total', 'capital', 'status', 'source', 'custom', 'dueDate', 'loanId']) {
      await expect(
        world.loans.addField(owner, s.poolA, created.id, { key, label: 'x' }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('does not let another pool add a field to this loan', async () => {
    const created = await create();
    await expect(
      world.loans.addField(await s.as('outsider'), s.poolA, created.id, { key: 'x', label: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('schedule', () => {
  it('projects a new loan: 480 rows, ends at 0, capital adds up to the principal', async () => {
    const created = await create();
    const schedule = await world.loans.schedule(await s.as('owner'), s.poolA, created.id);
    expect(ScheduleDto.parse(schedule)).toEqual(schedule);
    expect(schedule.schedule).toHaveLength(480);
    expect(schedule.schedule[0]).toMatchObject({
      number: 1,
      dueDate: '2020-10-05',
      source: 'projected',
    });
    expect(schedule.schedule.at(-1)).toMatchObject({
      number: 480,
      dueDate: '2060-09-05',
      balanceAfter: '0',
    });
    const capital = schedule.schedule.reduce((sum, row) => sum + Number(row.capital), 0);
    expect(capital).toBeCloseTo(111600, 2);
    expect(schedule.byYear).toEqual([]);
  });

  it('replaces projected rows with the actual ones and projects the rest from the real balance', async () => {
    const created = await create('owner', { termMonths: 12, principal: '1200', annualRate: '0' });
    await addInstallment(created.id, {
      number: 1,
      dueDate: '2020-10-05',
      capital: '150',
      interest: '0',
    });
    const schedule = await world.loans.schedule(await s.as('owner'), s.poolA, created.id);
    expect(schedule.schedule).toHaveLength(12);
    expect(schedule.schedule[0]).toMatchObject({
      number: 1,
      source: 'actual',
      balanceAfter: '1050',
    });
    // 1 050 € over the 11 left, 0 % rate: 95,45 each, the last takes the remainder.
    expect(schedule.schedule[1]).toMatchObject({
      number: 2,
      source: 'projected',
      capital: '95.45',
    });
    expect(schedule.schedule.at(-1)?.balanceAfter).toBe('0');
    expect(schedule.byYear).toEqual([
      expect.objectContaining({ year: 1, count: 1, capital: '150' }),
    ]);
  });
});

describe('plan: loans are Pro', () => {
  const refused = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(PlanLimitError);
    expect(error).toMatchObject({ status: 403, code: 'plan_limit', resource: 'real_estate' });
  };
  const anyId = '0192f2c8-7a1e-7000-8000-000000000001';

  it('answers plan_limit on a Free pool for every operation, reads included', async () => {
    const owner = await s.as('owner');
    await refused(billed.list(owner, s.poolA));
    await refused(billed.get(owner, s.poolA, anyId));
    await refused(billed.create(owner, s.poolA, reference()));
    await refused(billed.schedule(owner, s.poolA, anyId));
    await refused(billed.listInstallments(owner, s.poolA, anyId));
    await refused(billed.addField(owner, s.poolA, anyId, { key: 'x', label: 'x' }));
    await refused(billed.list(await s.as('viewer'), s.poolA));
    expect(await world.loans.list(owner, s.poolA)).toEqual({ loans: [] });
  });

  it('asks the role first: a viewer who writes gets 403 forbidden, not plan_limit', async () => {
    await expect(billed.create(await s.as('viewer'), s.poolA, reference())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('works on a Pro pool with billing on', async () => {
    await subscribe('pro');
    const created = await billed.create(await s.as('owner'), s.poolA, reference());
    expect(created.remainingInstallments).toBe(480);
    expect((await billed.list(await s.as('member'), s.poolA)).loans).toHaveLength(1);
  });
});

describe('what loans block', () => {
  it('a property with a loan cannot be deleted (409) until the loan is gone', async () => {
    const owner = await s.as('owner');
    const [holder] = (await world.holders.list(owner, s.poolA)).holders;
    const house = await world.properties.create(owner, s.poolA, {
      name: 'Casa',
      type: 'primary_home',
      purchaseDate: '2020-09-01',
      purchasePrice: '124000',
      holders: [{ holderId: holder?.id ?? '', sharePct: '100' }],
    });
    const created = await create('owner', { propertyId: house.id });
    await expect(world.properties.remove(owner, s.poolA, house.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await world.loans.remove(owner, s.poolA, created.id);
    await world.properties.remove(owner, s.poolA, house.id);
  });

  it('an account that pays a loan cannot be deleted (409)', async () => {
    const owner = await s.as('owner');
    const [holder] = (await world.holders.list(owner, s.poolA)).holders;
    const account = await world.accounts.create(owner, s.poolA, {
      type: 'checking',
      name: 'Conta à ordem',
      currency: 'EUR',
      holderIds: [holder?.id ?? ''],
    });
    await create('owner', { debitAccountId: account.id });
    await expect(world.accounts.remove(owner, s.poolA, account.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('audit', () => {
  it('records the changes without amounts', async () => {
    const created = await create('owner', { principal: '987654' });
    const row = await addInstallment(created.id, {
      number: 1,
      dueDate: '2020-10-05',
      capital: '555444',
      interest: '1',
    });
    const owner = await s.as('owner');
    await world.loans.updateInstallment(owner, s.poolA, created.id, row.id, { interest: '2' });
    await world.loans.updateField(owner, s.poolA, created.id, 'fees', { enabled: true });
    await world.loans.removeInstallment(owner, s.poolA, created.id, row.id);
    await world.loans.remove(owner, s.poolA, created.id);
    const log = await rows<{ action: string; entry: string }>(
      world.identity,
      sql`select action, to_jsonb(audit_log)::text as entry from audit_log where action like 'loan.%' and target = ${created.id} order by at`,
    );
    expect(log.map((entry) => entry.action)).toEqual([
      'loan.created',
      'loan.installment_added',
      'loan.installment_updated',
      'loan.field_updated',
      'loan.installment_deleted',
      'loan.deleted',
    ]);
    const text = JSON.stringify(log);
    expect(text).not.toContain('987654');
    expect(text).not.toContain('555444');
  });
});

const prepayment = (patch: object = {}) => ({
  kind: 'prepayment',
  date: '2023-02-01',
  amount: '15000',
  effect: 'reduce_installment',
  ...patch,
});
const addEvent = async (loanId: string, body: object, as: Persona = 'owner', poolId = s.poolA) =>
  world.loans.addEvent(await s.as(as), poolId, loanId, body);

describe('loan events', () => {
  it('a 15 000 € prepayment on 01/02/2023 is felt from the 03/2023 installment', async () => {
    const created = await create();
    const before = await world.loans.schedule(await s.as('owner'), s.poolA, created.id);
    const event = await addEvent(created.id, prepayment({ fee: '150' }));
    expect(EventDto.parse(event)).toEqual(event);
    expect(event).toMatchObject({
      kind: 'prepayment',
      date: '2023-02-01',
      effectiveFrom: '2023-03-01',
      amount: '15000.0000',
      fee: '150.0000',
      effect: 'reduce_installment',
      impact: { number: 30, remainingBefore: 451, remainingAfter: 451 },
    });
    const after = await world.loans.schedule(await s.as('owner'), s.poolA, created.id);
    expect(before.schedule).toHaveLength(480);
    expect(after.schedule.slice(0, 29)).toEqual(before.schedule.slice(0, 29));
    expect(after.schedule[29]).toMatchObject({ number: 30, dueDate: '2023-03-05' });
    expect(Number(after.schedule[29]?.payment)).toBeLessThan(Number(before.schedule[29]?.payment));
    expect(after.schedule.at(-1)?.balanceAfter).toBe('0');
  });

  it('records the reference rate changes and shows the rate in force on each installment', async () => {
    const created = await create('owner', {
      rateType: 'variable',
      rateIndex: 'euribor_6m',
      spread: '1',
    });
    await addEvent(created.id, { kind: 'rate_review', date: '2021-09-05', annualRate: '1.1' });
    await addEvent(created.id, { kind: 'rate_review', date: '2022-09-05', annualRate: '2.4' });
    await addEvent(created.id, {
      kind: 'rate_review',
      date: '2023-03-05',
      annualRate: '4.6',
      indexValue: '3.6',
      spread: '1',
    });
    await addEvent(created.id, {
      kind: 'renegotiation',
      date: '2023-10-01',
      annualRate: '3.2',
      spread: '0.9',
    });
    await addEvent(created.id, { kind: 'rate_review', date: '2026-04-05', annualRate: '2.9' });
    const { schedule } = await world.loans.schedule(await s.as('owner'), s.poolA, created.id);
    const rate = (n: number) => schedule[n - 1]?.annualRate;
    expect([
      rate(11),
      rate(12),
      rate(23),
      rate(24),
      rate(29),
      rate(30),
      rate(36),
      rate(37),
      rate(66),
      rate(67),
    ]).toEqual(['1.5', '1.1', '1.1', '2.4', '2.4', '4.6', '4.6', '3.2', '3.2', '2.9']);
    const list = await world.loans.listEvents(await s.as('owner'), s.poolA, created.id);
    expect(EventListDto.parse(list)).toEqual(list);
    expect(list.events.map((event) => event.impact?.number)).toEqual([12, 24, 30, 37, 67]);
    expect(
      list.events.every((event) => event.impact && Number(event.impact.paymentAfter) > 0),
    ).toBe(true);
  });

  it('takes the prepayment out of the outstanding capital, once it has happened', async () => {
    const created = await create();
    await addEvent(created.id, prepayment());
    expect(await world.loans.get(await s.as('owner'), s.poolA, created.id)).toMatchObject({
      prepaid: '15000',
      outstanding: '96600',
    });
    // Dated after today: recorded, but not paid yet.
    const later = await create('owner', { name: 'Outro' });
    await addEvent(later.id, prepayment({ date: '2099-01-01' }));
    expect((await world.loans.get(await s.as('owner'), s.poolA, later.id)).outstanding).toBe(
      '111600',
    );
  });

  it('keeps the plan going from the installments paid, with the events in it', async () => {
    const created = await create('owner', { termMonths: 12, principal: '1200', annualRate: '0' });
    await addInstallment(created.id, {
      number: 1,
      dueDate: '2020-10-05',
      capital: '100',
      interest: '0',
    });
    await addEvent(
      created.id,
      prepayment({ date: '2020-11-01', amount: '300', effect: 'reduce_term' }),
    );
    const { schedule } = await world.loans.schedule(await s.as('owner'), s.poolA, created.id);
    expect(schedule[0]).toMatchObject({ number: 1, source: 'actual', balanceAfter: '1100' });
    // 1 100 € - 300 € = 800 € at 100 €: eight more installments instead of eleven.
    expect(schedule).toHaveLength(9);
    expect(schedule.at(-1)?.balanceAfter).toBe('0');
  });

  it('deleting an event gives back the plan without it', async () => {
    const created = await create();
    const owner = await s.as('owner');
    const event = await addEvent(created.id, prepayment());
    await world.loans.removeEvent(owner, s.poolA, created.id, event.id);
    const { schedule } = await world.loans.schedule(owner, s.poolA, created.id);
    expect(schedule[29]?.dueDate).toBe('2023-03-05');
    expect(schedule.every((row) => row.annualRate === '1.5')).toBe(true);
    expect((await world.loans.get(owner, s.poolA, created.id)).outstanding).toBe('111600');
    await expect(
      world.loans.removeEvent(owner, s.poolA, created.id, event.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses what the loan cannot work with, and bodies the schema does not know (400)', async () => {
    const created = await create();
    const bad = (body: object) => addEvent(created.id, body);
    await expect(
      bad({ kind: 'rate_review', date: '2023-03-05', annualRate: '3', newInstallment: '1' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      bad({ kind: 'prepayment', date: '2023-02-01', amount: '1000' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(bad(prepayment({ amount: '0' }))).rejects.toBeInstanceOf(ValidationError);
    await expect(bad(prepayment({ effectiveFrom: '2023-01-01' }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(bad({ kind: 'renegotiation', date: '2023-10-01' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(bad({ kind: 'gift', date: '2023-10-01' })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad(prepayment({ poolId: s.poolB }))).rejects.toBeInstanceOf(ValidationError);
    await expect(bad(prepayment({ loanId: created.id }))).rejects.toBeInstanceOf(ValidationError);
    expect((await world.loans.listEvents(await s.as('owner'), s.poolA, created.id)).events).toEqual(
      [],
    );
  });

  it('answers 403 to member and viewer on writes, 404 to another pool, 401 without a session', async () => {
    const created = await create();
    const other = await create('outsider', {}, s.poolB);
    const event = await addEvent(created.id, prepayment());
    for (const as of ['member', 'viewer'] as const) {
      await expect(addEvent(created.id, prepayment(), as)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.loans.removeEvent(await s.as(as), s.poolA, created.id, event.id),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(
        (await world.loans.listEvents(await s.as(as), s.poolA, created.id)).events,
      ).toHaveLength(1);
    }
    const owner = await s.as('owner');
    await expect(world.loans.listEvents(owner, s.poolA, other.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.loans.addEvent(owner, s.poolA, other.id, prepayment()),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.loans.removeEvent(owner, s.poolA, other.id, event.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Another loan of the same pool does not own the event either.
    const second = await create('owner', { name: 'Segundo' });
    await expect(
      world.loans.removeEvent(owner, s.poolA, second.id, event.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.loans.listEvents(new Headers(), s.poolA, created.id)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(
      world.loans.listEvents(await s.as('outsider'), s.poolA, created.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('is Pro: a Free pool gets plan_limit on events and on the preview', async () => {
    const owner = await s.as('owner');
    const anyId = '0192f2c8-7a1e-7000-8000-000000000001';
    const calls = [
      () => billed.listEvents(owner, s.poolA, anyId),
      () => billed.addEvent(owner, s.poolA, anyId, prepayment()),
      () => billed.removeEvent(owner, s.poolA, anyId, anyId),
      () => billed.reviewPreview(owner, s.poolA, anyId),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toBeInstanceOf(PlanLimitError);
    }
  });
});

describe('review preview', () => {
  const worker = createAppDatabase(testEnv().TEST_DATABASE_URL_WORKER, 2);
  afterAll(async () => {
    await worker.close();
  });
  const variable = (patch: object = {}) =>
    create('owner', {
      rateType: 'variable',
      rateIndex: 'euribor_6m',
      spread: '1.2',
      reviewMonths: 6,
      ...patch,
    });

  it('has nothing to preview for a fixed rate (400)', async () => {
    const created = await create();
    await expect(
      world.loans.reviewPreview(await s.as('owner'), s.poolA, created.id),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('shows the current installment and no new one until the Euribor job has run', async () => {
    const created = await variable();
    const preview = await world.loans.reviewPreview(await s.as('owner'), s.poolA, created.id);
    expect(ReviewPreviewDto.parse(preview)).toEqual(preview);
    expect(preview).toMatchObject({
      rateIndex: 'euribor_6m',
      indexValue: null,
      newRate: null,
      newPayment: null,
      outstanding: '111600',
      remainingInstallments: 480,
    });
    expect(Number(preview.currentPayment)).toBeGreaterThan(0);
  });

  it('with the newest Euribor: index plus spread, and the installment it gives', async () => {
    const created = await variable();
    await indexRatesRepo.upsertMany(worker.db, [
      { rateIndex: 'euribor_6m', period: '2026-08-01', rate: '2.1', source: 'ecb' },
      { rateIndex: 'euribor_6m', period: '2026-09-01', rate: '2.3', source: 'ecb' },
      { rateIndex: 'euribor_3m', period: '2026-09-01', rate: '9', source: 'ecb' },
    ]);
    const preview = await world.loans.reviewPreview(await s.as('owner'), s.poolA, created.id);
    expect(preview).toMatchObject({
      indexPeriod: '2026-09-01',
      indexValue: '2.300000',
      spread: '1.200000',
      newRate: '3.5',
      newPayment: frenchPayment('111600', '3.5', 480),
    });
    expect(preview.nextReviewDate).not.toBeNull();
  });

  it('answers 404 to another pool and to a non-member', async () => {
    const other = await variable();
    await expect(
      world.loans.reviewPreview(await s.as('outsider'), s.poolA, other.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    const mine = await create('outsider', {}, s.poolB);
    await expect(
      world.loans.reviewPreview(await s.as('owner'), s.poolA, mine.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('audit of events', () => {
  it('records them without amounts', async () => {
    const created = await create();
    const event = await addEvent(created.id, prepayment({ amount: '424242', fee: '171717' }));
    await world.loans.removeEvent(await s.as('owner'), s.poolA, created.id, event.id);
    const log = await rows<{ action: string; entry: string }>(
      world.identity,
      sql`select action, to_jsonb(audit_log)::text as entry from audit_log where action like 'loan.event_%' and target = ${created.id} order by at`,
    );
    expect(log.map((entry) => entry.action)).toEqual(['loan.event_added', 'loan.event_deleted']);
    const text = JSON.stringify(log);
    expect(text).not.toContain('424242');
    expect(text).not.toContain('171717');
  });
});
