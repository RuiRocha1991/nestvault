import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createEntitlements,
  createRealEstateImportsService,
  ForbiddenError,
  logger,
  NotFoundError,
  PayloadTooLargeError,
  PlanLimitError,
  RateLimitError,
  RealEstateCommitResultDto,
  RealEstatePreviewDto,
  TEMPLATE_NAMES,
  UnauthorizedError,
  UnprocessableError,
  UnsupportedMediaTypeError,
  ValidationError,
  type RealEstateImportsService,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { rows } from '../support/auth-harness';
import {
  installmentRow,
  mortgageWorkbookResponse,
  realEstateResponse,
  type FakeRealEstateParser,
} from '../support/real-estate-imports';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const WORKBOOK = readFileSync(
  join(import.meta.dirname, '..', 'fixtures', 'mortgage', 'mortgage-workbook.anonymized.xlsx'),
);

let world: ApiWorld;
let s: Scenario;
let parser: FakeRealEstateParser;
// The world's service has billing off (every pool is Pro); this one has it on: a pool without a
// subscription is Free.
let billed: RealEstateImportsService;

beforeAll(async () => {
  logger.level = 'silent';
  world = await createApiWorld();
  parser = world.realEstateKit.parser;
  billed = createRealEstateImportsService({
    auth: world.auth,
    identity: world.identity,
    limiter: world.limiter,
    entitlements: createEntitlements({ identity: world.identity, billingEnabled: true }),
    parser,
    run: world.database.withPool,
    trustedProxyHops: 1,
  });
});

beforeEach(async () => {
  s = await world.newScenario();
  parser.reset();
});

afterAll(async () => {
  await world.close();
});

// ---------------------------------------------------------------------------------- helpers

const ownerOf = (poolId: string): Persona => (poolId === s.poolA ? 'owner' : 'outsider');

async function makeProperty(poolId = s.poolA) {
  const headers = await s.as(ownerOf(poolId));
  const [holder] = (await world.holders.list(headers, poolId)).holders;
  return world.properties.create(headers, poolId, {
    name: 'Casa',
    type: 'primary_home',
    purchaseDate: '2020-09-01',
    purchasePrice: '124000',
    holders: [{ holderId: holder?.id ?? '', sharePct: '100' }],
  });
}

async function makeLoan(propertyId?: string, poolId = s.poolA) {
  return world.loans.create(await s.as(ownerOf(poolId)), poolId, {
    name: 'Crédito habitação',
    kind: 'mortgage',
    ...(propertyId ? { propertyId } : {}),
    principal: '111600',
    startDate: '2020-09-01',
    firstDueDate: '2020-10-05',
    termMonths: 480,
    rateType: 'fixed',
    annualRate: '1.5',
    paymentDay: 5,
  });
}

interface Send {
  as?: Persona;
  poolId?: string;
  bytes?: Uint8Array;
  fileName?: string;
  fields?: Record<string, unknown>;
  service?: RealEstateImportsService;
}

const read = ({ bytes = WORKBOOK, fileName = 'Credito_Habitacao.xlsx', fields = {} }: Send) =>
  Promise.resolve({ fileName, bytes, fields });

async function preview(send: Send = {}) {
  const { as = 'owner', poolId = s.poolA, service = world.realEstateImports } = send;
  return service.preview(await s.as(as), poolId, () => read(send));
}

async function commit(send: Send = {}) {
  const { as = 'owner', poolId = s.poolA, service = world.realEstateImports } = send;
  return service.commit(await s.as(as), poolId, () => read(send));
}

/** A property with its loan, as the dialog sends them. */
async function target() {
  const property = await makeProperty();
  const loan = await makeLoan(property.id);
  return { property, loan, fields: { loanId: loan.id } };
}

async function figures(loanId: string, propertyId: string) {
  const headers = await s.as('owner');
  const installments = (await world.loans.listInstallments(headers, s.poolA, loanId)).installments;
  const events = (await world.loans.listEvents(headers, s.poolA, loanId)).events;
  const works = (await world.works.list(headers, s.poolA)).projects.filter(
    (project) => project.propertyId === propertyId,
  );
  return { installments, events, works };
}

async function auditEntries() {
  return rows<{ action: string; target: string | null; meta: Record<string, unknown> }>(
    world.identity,
    sql`select action, target, meta from audit_log where pool_id = ${s.poolA} and action = 'import.realestate_committed' order by at, id`,
  );
}

const sumOf = (values: string[]) =>
  values.reduce((total, value) => total + Math.round(Number(value) * 100), 0) / 100;

// ------------------------------------------------------------------------------- the preview

describe('real estate import: preview', () => {
  it('shows the reference workbook: 92 rows by sheet, totals, costs and the two notices', async () => {
    const result = await preview();
    expect(RealEstatePreviewDto.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      parserId: 'mortgage-workbook-xlsx',
      confidence: 1,
      rowCount: 92,
      plan: null,
      needs: { loan: true, property: true },
    });
    const imported = result.sheets.filter((sheet) => sheet.action !== 'recalculated');
    // The CPI sheet is read and shown, never stored: it is not counted as an import.
    expect(result.sheets.find((sheet) => sheet.sheet === 'Inflação')?.action).toBe('shown');
    expect(imported.map((sheet) => [sheet.sheet, sheet.rows])).toEqual([
      ['Sumário', 73],
      ['Amortização', 1],
      ['Remodelações', 4],
      ['Pagamentos', 8],
      ['Inflação', 6],
    ]);
    expect(sumOf(imported.map((sheet) => String(sheet.rows)))).toBe(92);
    expect(sumOf([result.totals.capital, result.totals.prepayments])).toBe(25511.72);
    expect(Number(result.totals.interest)).toBe(14058.99);
    expect(Number(result.totals.works)).toBe(22071.46);
    expect(Number(result.totals.payments)).toBe(22071.46);
    expect(Number(result.costs?.total)).toBe(2559.71);
    expect(result.notices).toEqual({ creditInsurance: '225.38', inflationSummed: true });
    expect(result.inflation).toMatchObject({ compoundedPct: '19.3', summedPct: '18.1' });
    expect(result.inflation?.rows).toHaveLength(6);
    expect(result.fieldsWithValues).toContain('creditInsurance');
  });

  it('with a loan and a property says what importing would do, and writes nothing', async () => {
    const { property, loan, fields } = await target();
    const result = await preview({ fields });
    // One preview carries the plan for both values of "update existing".
    for (const plan of [result.plan?.keep, result.plan?.update]) {
      expect(plan).toMatchObject({
        installments: { create: 73, update: 0, unchanged: 0, rejected: 0 },
        prepayments: { create: 1, unchanged: 0, rejected: 0 },
        works: { create: 4 },
        payments: { create: 8 },
        costs: 'fill',
        costsRejected: 0,
        inflation: 6,
      });
      expect(plan?.fieldsEnabled.sort()).toEqual(['creditInsurance', 'fees', 'stampTax']);
    }
    const { installments, events, works } = await figures(loan.id, property.id);
    expect([installments.length, events.length, works.length]).toEqual([0, 0, 0]);
    expect(await auditEntries()).toEqual([]);
  });

  it('asks the parser to detect and then to parse with the best candidate', async () => {
    parser.candidates = [
      { parser_id: 'mortgage-workbook-xlsx', version: '1', confidence: 0.9 },
      { parser_id: 'other', version: '1', confidence: 0.6 },
    ];
    await preview();
    expect(parser.calls).toEqual(['detect', 'parse:mortgage-workbook-xlsx']);
  });

  it('refuses a file nobody recognises (422) and a PDF (415) before the parser sees it', async () => {
    parser.candidates = [];
    await expect(preview()).rejects.toBeInstanceOf(UnprocessableError);
    parser.calls = [];
    const pdf = Buffer.from('%PDF-1.4\n%fake');
    await expect(preview({ bytes: pdf, fileName: 'x.pdf' })).rejects.toBeInstanceOf(
      UnsupportedMediaTypeError,
    );
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 0), Buffer.from('DOS mode')]);
    await expect(preview({ bytes: exe, fileName: 'x.xlsx' })).rejects.toBeInstanceOf(
      UnsupportedMediaTypeError,
    );
    expect(parser.calls).toEqual([]);
  });

  it('413 over 10 MB', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1).fill(0x61);
    await expect(preview({ bytes: big, fileName: 'x.csv' })).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
  });
});

// -------------------------------------------------------------------------------- the commit

describe('real estate import: commit', () => {
  it('imports the reference workbook to the reference totals', async () => {
    const { property, loan, fields } = await target();
    const result = await commit({ fields });
    expect(RealEstateCommitResultDto.parse(result)).toEqual(result);
    expect(result).toMatchObject({ loanId: loan.id, propertyId: property.id });
    expect(result.result).toMatchObject({
      installments: { create: 73 },
      prepayments: { create: 1 },
      works: { create: 4 },
      payments: { create: 8 },
      costs: 'fill',
    });

    const { installments, events, works } = await figures(loan.id, property.id);
    expect(installments).toHaveLength(73);
    expect(installments.every((row) => row.source === 'import')).toBe(true);
    const capital = sumOf(installments.map((row) => row.capital));
    expect(capital + Number(events[0]?.amount)).toBe(25511.72);
    expect(sumOf(installments.map((row) => row.interest))).toBe(14058.99);
    expect(sumOf(installments.map((row) => row.creditInsurance))).toBe(225.38);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'prepayment', date: '2023-02-01' });
    expect(Number(events[0]?.amount)).toBe(15000);
    expect(works).toHaveLength(4);
    expect(sumOf(works.map((work) => work.budget))).toBe(22071.46);
    expect(works.flatMap((work) => work.phases)).toHaveLength(8);
    expect(sumOf(works.flatMap((work) => work.phases.map((phase) => phase.amount)))).toBe(22071.46);

    const headers = await s.as('owner');
    const costs = (await world.properties.get(headers, s.poolA, property.id)).costs;
    expect(Number(costs.total)).toBe(2559.71);

    const loanAfter = await world.loans.get(headers, s.poolA, loan.id);
    const enabled = loanAfter.fields.filter((f) => f.enabled).map((f) => f.key);
    expect(enabled.sort()).toEqual([
      'creditInsurance',
      'fees',
      'homeInsurance',
      'lifeInsurance',
      'stampTax',
    ]);
  });

  it('importing the same file again adds nothing', async () => {
    const { property, loan, fields } = await target();
    await commit({ fields });
    const before = await figures(loan.id, property.id);
    const again = await commit({ fields });
    expect(again.result).toMatchObject({
      installments: { create: 0, update: 0, unchanged: 73 },
      prepayments: { create: 0, unchanged: 1 },
      works: { create: 0, update: 0, unchanged: 4 },
      payments: { create: 0, update: 0, unchanged: 8 },
      costs: 'unchanged',
      fieldsEnabled: [],
    });
    expect(await figures(loan.id, property.id)).toEqual(before);
  });

  it('counts the prepayment exactly once: the balance is principal - installment capital - prepayment', async () => {
    const { property, loan, fields } = await target();
    const owner = await s.as('owner');
    // By hand: 111 600 - 10 511,72 (capital of the 73 installments, the prepayment month taken
    // without the extra, as the parser stores it) - 15 000 (the prepayment) = 86 088,28.
    const expected = 111600 - 10511.72 - 15000;
    const outstanding = async () => {
      const detail = await world.loans.get(owner, s.poolA, loan.id);
      const schedule = (await world.loans.schedule(owner, s.poolA, loan.id)).schedule;
      const last = schedule.find((row) => row.number === 73);
      return { loan: Number(detail.outstanding), lastActual: Number(last?.balanceAfter) };
    };
    await commit({ fields });
    const first = await outstanding();
    expect(first.loan).toBeCloseTo(expected, 2);
    expect(first.lastActual).toBeCloseTo(expected, 2);
    // The prepayment month's installment holds its regular capital, not the 15 000 on top.
    const { installments, events } = await figures(loan.id, property.id);
    expect(events.filter((event) => event.kind === 'prepayment')).toHaveLength(1);
    expect(Number(installments.find((row) => row.number === 30)?.capital)).toBeLessThan(1000);
    // Importing again, with the update flag on or off, changes nothing.
    for (const update of ['true', 'false']) {
      const again = await commit({ fields: { ...fields, update } });
      expect(again.result.installments).toMatchObject({ create: 0, update: 0, unchanged: 73 });
      expect(again.result.prepayments).toMatchObject({ create: 0, unchanged: 1 });
      const after = await outstanding();
      expect(after.loan).toBeCloseTo(expected, 2);
      expect(after.lastActual).toBeCloseTo(expected, 2);
    }
  });

  it('two commits of the same file in parallel write every row once', async () => {
    const { property, loan, fields } = await target();
    const results = await Promise.all([commit({ fields }), commit({ fields })]);
    const created = results.map((r) => r.result.prepayments.create + r.result.works.create);
    expect(created.sort()).toEqual([0, 5]); // one of them did the work, the other found it done
    const after = await figures(loan.id, property.id);
    expect(after.installments).toHaveLength(73);
    expect(after.events.filter((event) => event.kind === 'prepayment')).toHaveLength(1);
    expect(after.works).toHaveLength(4);
    expect(after.works.flatMap((work) => work.phases)).toHaveLength(8);
  });

  it('a phase marked paid by hand stays paid when the file says planned', async () => {
    const { property, loan, fields } = await target();
    // The file starts with every phase planned; the household then marks one paid by hand.
    const planned = mortgageWorkbookResponse();
    for (const row of planned.rows) {
      if (row.kind === 'work_payment') Object.assign(row, { status: 'planned', paid_date: null });
    }
    parser.response = planned;
    await commit({ fields });
    const owner = await s.as('owner');
    const works = (await figures(loan.id, property.id)).works;
    const work = works[0];
    const phase = work?.phases[0];
    await world.works.updatePayment(owner, s.poolA, work?.id ?? '', phase?.id ?? '', {
      paidDate: '2026-05-05',
    });
    const result = await commit({ fields });
    expect(result.result.payments).toMatchObject({ update: 0, kept: 1 });
    const after = (await figures(loan.id, property.id)).works
      .flatMap((w) => w.phases)
      .find((p) => p.id === phase?.id);
    expect(after).toMatchObject({ status: 'paid', paidDate: '2026-05-05' });
  });

  it('an acquisition cost that does not fit the column is skipped with a count, not a 500', async () => {
    const { property, fields } = await target();
    const response = mortgageWorkbookResponse();
    if (response.meta.acquisition_costs) response.meta.acquisition_costs.imt = '100000000000000';
    parser.response = response;
    const result = await commit({ fields });
    expect(result.result.costsRejected).toBe(1);
    const costs = (await world.properties.get(await s.as('owner'), s.poolA, property.id)).costs;
    expect(Number(costs.imt)).toBe(0);
    expect(Number(costs.total)).toBeCloseTo(2559.71 - 631.86, 2);
  });

  it('never overwrites notes, descriptions or the status the household chose', async () => {
    const { property, loan, fields } = await target();
    await commit({ fields });
    const owner = await s.as('owner');
    const [kitchen] = (await figures(loan.id, property.id)).works;
    await world.works.update(owner, s.poolA, kitchen?.id ?? '', {
      notes: 'my note',
      description: 'my words',
    });
    const [first] = (await figures(loan.id, property.id)).installments;
    await world.loans.updateInstallment(owner, s.poolA, loan.id, first?.id ?? '', {
      status: 'scheduled',
    });
    // The file now has other figures: the update option may change them, but not the notes.
    const changed = mortgageWorkbookResponse();
    for (const row of changed.rows) {
      if (row.kind === 'work') row.budget = '1';
      if (row.kind === 'installment' && row.number === 1) row.capital = '999';
    }
    parser.response = changed;
    const result = await commit({ fields });
    expect(result.result.works.update).toBe(4);
    expect(result.result.installments.update).toBe(1);
    const after = await figures(loan.id, property.id);
    const kitchenAfter = after.works.find((work) => work.id === kitchen?.id);
    expect(kitchenAfter).toMatchObject({ notes: 'my note', description: 'my words' });
    expect(Number(kitchenAfter?.budget)).toBe(1);
    expect(after.installments[0]).toMatchObject({ capital: '999.0000', status: 'scheduled' });
  });

  it('with update off leaves existing rows alone', async () => {
    const { property, loan, fields } = await target();
    await commit({ fields });
    const changed = mortgageWorkbookResponse();
    for (const row of changed.rows) if (row.kind === 'work') row.budget = '1';
    parser.response = changed;
    const result = await commit({ fields: { ...fields, update: 'false' } });
    expect(result.result.works).toMatchObject({ update: 0, unchanged: 4 });
    const budgets = (await figures(loan.id, property.id)).works.map((work) => work.budget);
    expect(sumOf(budgets)).toBe(22071.46);
  });

  it('never moves a phase that is linked to a bank movement', async () => {
    const { property, loan, fields } = await target();
    await commit({ fields });
    const owner = await s.as('owner');
    const account = await world.accounts.create(owner, s.poolA, {
      type: 'checking',
      name: 'BPI',
      currency: 'EUR',
      holderIds: [(await world.holders.list(owner, s.poolA)).holders[0]?.id ?? ''],
    });
    const movement = await world.transactions.create(owner, s.poolA, {
      accountId: account.id,
      date: '2023-03-03',
      description: 'Deposit',
      amount: '-2736.14',
    });
    const [kitchen] = (await figures(loan.id, property.id)).works;
    const phase = kitchen?.phases.find((candidate) => candidate.description === 'Deposit');
    await world.works.linkTransaction(owner, s.poolA, kitchen?.id ?? '', phase?.id ?? '', {
      transactionId: movement.id,
    });
    const changed = mortgageWorkbookResponse();
    for (const row of changed.rows) {
      if (
        row.kind === 'work_payment' &&
        row.description === 'Deposit' &&
        row.work === kitchen?.name
      )
        row.paid_date = '2023-03-04';
    }
    parser.response = changed;
    const result = await commit({ fields });
    expect(result.result.payments).toMatchObject({ update: 0, kept: 1 });
    const after = (await figures(loan.id, property.id)).works.find((w) => w.id === kitchen?.id);
    expect(after?.phases.find((p) => p.id === phase?.id)).toMatchObject({
      paidDate: '2023-03-03',
      transactionId: movement.id,
    });
  });

  it('imports the CSV templates: payments make their project when it is missing', async () => {
    const property = await makeProperty();
    parser.candidates = [{ parser_id: 'works-payments-csv', version: '1', confidence: 0.9 }];
    parser.response = realEstateResponse(
      [
        {
          kind: 'work_payment',
          work: 'Windows',
          description: 'Deposit',
          amount: '500',
          planned_date: '2026-01-01',
          paid_date: '2026-01-02',
          status: 'paid',
        },
        {
          kind: 'work_payment',
          work: 'Windows',
          description: 'Final payment',
          amount: '1500',
          planned_date: '2026-03-01',
          paid_date: null,
          status: 'planned',
        },
      ],
      'works-payments-csv',
    );
    const result = await commit({
      bytes: Buffer.from('Obra;Descrição;Valor\nWindows;Deposit;500\n'),
      fileName: 'works-payments.csv',
      fields: { propertyId: property.id },
    });
    expect(result).toMatchObject({ loanId: null, propertyId: property.id });
    expect(result.result.works.create).toBe(1);
    const [windows] = (await world.works.list(await s.as('owner'), s.poolA)).projects;
    expect(windows).toMatchObject({ name: 'Windows', status: 'in_progress' });
    expect(Number(windows?.budget)).toBe(2000);
    expect(windows?.phases).toHaveLength(2);
  });

  it('imports installment CSV rows into a loan without a property', async () => {
    const loan = await makeLoan();
    parser.candidates = [{ parser_id: 'loan-installments-csv', version: '1', confidence: 0.9 }];
    parser.response = realEstateResponse([installmentRow(1), installmentRow(2)]);
    const result = await commit({
      bytes: Buffer.from('Número;Data;Capital;Juros\n1;2026-01-05;100;20\n'),
      fileName: 'installments.csv',
      fields: { loanId: loan.id },
    });
    expect(result).toMatchObject({ loanId: loan.id, propertyId: null });
    expect(result.result.installments.create).toBe(2);
  });

  it('rejects the whole file when the loan or property it needs is missing (400, nothing written)', async () => {
    const { property, loan } = await target();
    await expect(commit({ fields: {} })).rejects.toBeInstanceOf(ValidationError);
    await expect(commit({ fields: { loanId: loan.id } })).resolves.toBeDefined();
    // a loan of the property is enough for the works as well; without the property no works
    const bare = await makeLoan();
    await expect(commit({ fields: { loanId: bare.id } })).rejects.toBeInstanceOf(ValidationError);
    const { works } = await figures(bare.id, property.id);
    expect(works.length).toBe(4); // those of the first commit, none added
  });

  it('answers 409 when two imports of one loan collide', async () => {
    const { fields } = await target();
    const results = await Promise.allSettled([commit({ fields }), commit({ fields })]);
    const failures = results.filter((r) => r.status === 'rejected');
    // Either both succeed in turn (the second finds everything there) or one loses the race.
    for (const failure of failures) {
      expect(failure.reason).toMatchObject({ status: 409 });
    }
  });
});

// ------------------------------------------------------------------------------------ guards

describe('real estate import: who may import', () => {
  it('preview: owner, admin and member (imports.run); not viewer (403), not a stranger (404), not anonymous (401)', async () => {
    for (const as of ['owner', 'admin', 'member'] as const) {
      expect((await preview({ as })).rowCount).toBe(92);
    }
    await expect(preview({ as: 'viewer' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(preview({ as: 'outsider' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.realEstateImports.preview(new Headers(), s.poolA, () => read({})),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(parser.calls.length).toBe(6); // 3 uploads, detect + parse each
  });

  it('commit also needs realestate.write: owner and admin only', async () => {
    const { fields } = await target();
    await expect(commit({ as: 'member', fields })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(commit({ as: 'viewer', fields })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(commit({ as: 'outsider', fields })).rejects.toBeInstanceOf(NotFoundError);
    expect((await commit({ as: 'admin', fields })).result.installments.create).toBe(73);
  });

  it('the body of a refused caller is never read', async () => {
    const reader = vi.fn(() => read({}));
    await expect(
      world.realEstateImports.preview(await s.as('viewer'), s.poolA, reader),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      world.realEstateImports.commit(await s.as('outsider'), s.poolA, reader),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(reader).not.toHaveBeenCalled();
  });

  it('is Pro: a Free pool gets plan_limit on the preview, the commit and the templates', async () => {
    const headers = await s.as('owner');
    await expect(billed.preview(headers, s.poolA, () => read({}))).rejects.toBeInstanceOf(
      PlanLimitError,
    );
    await expect(billed.commit(headers, s.poolA, () => read({}))).rejects.toBeInstanceOf(
      PlanLimitError,
    );
    await expect(billed.template(headers, s.poolA, 'loan-installments')).rejects.toBeInstanceOf(
      PlanLimitError,
    );
    expect(parser.calls).toEqual([]);
  });

  it('allows 20 uploads an hour per pool and then answers 429', async () => {
    for (let n = 0; n < 20; n += 1) await preview();
    await expect(preview()).rejects.toBeInstanceOf(RateLimitError);
    expect((await preview({ as: 'outsider', poolId: s.poolB })).rowCount).toBe(92);
  });
});

describe('real estate import: input', () => {
  it('accepts only the documented fields, strictly (400)', async () => {
    for (const fields of [
      { poolId: s.poolA },
      { status: 'committed' },
      { update: 'maybe' },
      { loanId: 'not-a-uuid' },
      { loanId: "' OR 1=1 --" },
      { propertyId: '1; DROP TABLE loans; --' },
    ]) {
      await expect(preview({ fields })).rejects.toBeInstanceOf(ValidationError);
      await expect(commit({ fields })).rejects.toBeInstanceOf(ValidationError);
    }
    expect(parser.calls).toEqual([]);
  });

  it('a loan or property of another pool is a 400 and nothing is written', async () => {
    const foreignProperty = await makeProperty(s.poolB);
    const foreignLoan = await makeLoan(foreignProperty.id, s.poolB);
    for (const fields of [{ loanId: foreignLoan.id }, { propertyId: foreignProperty.id }]) {
      await expect(commit({ fields })).rejects.toBeInstanceOf(ValidationError);
      await expect(preview({ fields })).rejects.toBeInstanceOf(ValidationError);
    }
    const outsider = await s.as('outsider');
    expect(
      (await world.loans.listInstallments(outsider, s.poolB, foreignLoan.id)).installments,
    ).toEqual([]);
    expect((await world.works.list(outsider, s.poolB)).projects).toEqual([]);
  });

  it('text from the file is data: an SQL payload is stored as a name', async () => {
    const property = await makeProperty();
    const payload = "Kitchen'; DROP TABLE works_projects; --";
    parser.response = realEstateResponse([
      {
        kind: 'work',
        name: payload,
        supplier: "' OR 1=1 --",
        budget: '10',
        deposit_pct: null,
        status: 'planned',
        start_date: null,
        planned_end: null,
      },
    ]);
    await commit({ fields: { propertyId: property.id } });
    const [project] = (await world.works.list(await s.as('owner'), s.poolA)).projects;
    expect(project).toMatchObject({ name: payload, supplier: "' OR 1=1 --" });
  });
});

describe('real estate import: audit and templates', () => {
  it('records the commit with an id and counts, never content', async () => {
    const { loan, fields } = await target();
    await preview({ fields });
    await commit({ fields });
    const entries = await auditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'import.realestate_committed',
      target: loan.id,
      meta: { count: 73 + 1 + 4 + 8 },
    });
    expect(JSON.stringify(entries)).not.toMatch(/Kitchen|Supplier|Casa/);
  });

  it('serves the two templates and 404s an unknown name', async () => {
    const headers = await s.as('owner');
    for (const name of TEMPLATE_NAMES) {
      const file = await world.realEstateImports.template(headers, s.poolA, name);
      expect(file.fileName).toBe(`${name}.csv`);
      expect(file.text.split('\n')[0]).toContain(';');
    }
    for (const name of ['nope', '../secret', '__proto__', 'constructor']) {
      await expect(world.realEstateImports.template(headers, s.poolA, name)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    await expect(
      world.realEstateImports.template(await s.as('viewer'), s.poolA, 'loan-installments'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      world.realEstateImports.template(await s.as('outsider'), s.poolA, 'loan-installments'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
