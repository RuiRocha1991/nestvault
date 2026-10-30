import {
  accountsRepo,
  indexRatesRepo,
  loanEventsRepo,
  loansRepo,
  newId,
  propertiesRepo,
  transactionsRepo,
  withPool,
  type IdentityDatabase,
  type InstallmentValues,
  type LoanFieldValues,
  type LoanRow,
  type LoanValues,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
} from '@nestvault/db';
import {
  type InstallmentAmounts,
  type LoanEvent,
  BUILTIN_LOAN_FIELDS,
  DEFAULT_ENABLED_LOAN_FIELDS,
  addDays,
  defaultEffectiveFrom,
  dec,
  installmentCostSplit,
  installmentTotal,
  MATCH_DAYS,
  matchInstallments,
  nextReviewDate,
  projectLoan,
  reviewedRate,
  reviewPreview,
  sum,
  toPlain,
  totalsByContractYear,
} from '@nestvault/domain';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { isUniqueViolation } from '../db-errors';
import type { Entitlements } from '../entitlements';
import { ConflictError, NotFoundError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { invalid, parseId, refOrRethrow } from '../investments/checks';
import { clientIpResolver } from '../rate-limit/client-ip';
import { zodProblem } from '../zod-problem';

import {
  CreateEventInput,
  CreateFieldInput,
  CreateInstallmentInput,
  CreateLoanInput,
  EventDto,
  EventListDto,
  fieldSettings,
  InstallmentDto,
  InstallmentLinkDto,
  InstallmentListDto,
  LinkInstallmentInput,
  LoanDto,
  LoanFieldDto,
  LoanListDto,
  MatchResultDto,
  ReviewPreviewDto,
  ScheduleDto,
  toAmounts,
  toDomainEvent,
  toEventDto,
  toFieldDto,
  toInstallmentDto,
  toLoanDto,
  UpdateFieldInput,
  UpdateInstallmentInput,
  UpdateLoanInput,
} from './schemas';

export interface LoansService {
  /** The pool's loans with their fields and what has been paid (`pool.read`, Pro). */
  list(headers: Headers, poolId: string): Promise<LoanListDto>;
  /** One loan (`pool.read`, Pro). */
  get(headers: Headers, poolId: string, id: string): Promise<LoanDto>;
  /** Creates a loan with the default fields (`realestate.write`, Pro). */
  create(headers: Headers, poolId: string, input: unknown): Promise<LoanDto>;
  /** Changes a loan's terms; fields left out stay (`realestate.write`, Pro). */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<LoanDto>;
  /** Deletes a loan with its fields and installments (`realestate.write`, Pro). */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
  /** Actual installments followed by the projection of the rest, with totals per year (`pool.read`, Pro). */
  schedule(headers: Headers, poolId: string, id: string): Promise<ScheduleDto>;
  /** The installments entered so far, oldest first (`pool.read`, Pro). */
  listInstallments(headers: Headers, poolId: string, id: string): Promise<InstallmentListDto>;
  /** Records an installment; one per number (`realestate.write`, Pro). */
  addInstallment(
    headers: Headers,
    poolId: string,
    id: string,
    input: unknown,
  ): Promise<InstallmentDto>;
  /** Corrects an installment (`realestate.write`, Pro). */
  updateInstallment(
    headers: Headers,
    poolId: string,
    id: string,
    installmentId: string,
    input: unknown,
  ): Promise<InstallmentDto>;
  /** Deletes an installment (`realestate.write`, Pro). */
  removeInstallment(
    headers: Headers,
    poolId: string,
    id: string,
    installmentId: string,
  ): Promise<void>;
  /**
   * Marks an installment paid by a bank debit: from then on only its interest, fees, taxes and
   * insurances count as an expense, the capital as savings (`realestate.write`, Pro).
   */
  linkInstallment(
    headers: Headers,
    poolId: string,
    id: string,
    installmentId: string,
    input: unknown,
  ): Promise<InstallmentLinkDto>;
  /** Takes the link away; the debit counts as a plain expense again (`realestate.write`, Pro). */
  unlinkInstallment(
    headers: Headers,
    poolId: string,
    id: string,
    installmentId: string,
  ): Promise<void>;
  /**
   * Links every unlinked installment to the debit of the loan's account that matches its total
   * (± a few cents) within a few days (`realestate.write`, Pro).
   */
  matchInstallments(headers: Headers, poolId: string, id: string): Promise<MatchResultDto>;
  /** The events of a loan in the order they take effect, each with what it did (`pool.read`, Pro). */
  listEvents(headers: Headers, poolId: string, id: string): Promise<EventListDto>;
  /** Records a prepayment, a rate review or a renegotiation (`realestate.write`, Pro). */
  addEvent(headers: Headers, poolId: string, id: string, input: unknown): Promise<EventDto>;
  /** Deletes an event; the schedule goes back to what it was without it (`realestate.write`, Pro). */
  removeEvent(headers: Headers, poolId: string, id: string, eventId: string): Promise<void>;
  /** What the next review would do with the latest index value (`pool.read`, Pro). */
  reviewPreview(headers: Headers, poolId: string, id: string): Promise<ReviewPreviewDto>;
  /** Adds a custom installment field (`realestate.write`, Pro). */
  addField(headers: Headers, poolId: string, id: string, input: unknown): Promise<LoanFieldDto>;
  /** Enables, disables or renames a field; its values are kept (`realestate.write`, Pro). */
  updateField(
    headers: Headers,
    poolId: string,
    id: string,
    key: string,
    input: unknown,
  ): Promise<LoanFieldDto>;
}

export interface LoansServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Loans are a Pro feature (ADR 0003). */
  entitlements: Entitlements;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  now?: () => Date;
}

const ZERO = '0';
const BUILTIN_LABELS: Record<(typeof BUILTIN_LOAN_FIELDS)[number], string> = {
  lifeInsurance: 'Life insurance',
  homeInsurance: 'Home insurance',
  creditInsurance: 'Credit insurance',
  fees: 'Fees',
  stampTax: 'Stamp tax',
};

type Permission = 'pool.read' | 'realestate.write';

/** Cross-field rules of the terms (the check constraints repeat the single-column ones). */
function assertTerms(values: LoanValues): LoanValues {
  if (values.rateType !== 'fixed' && !values.rateIndex) {
    throw invalid('rateIndex', 'a variable or mixed rate needs an index');
  }
  if (values.rateType === 'mixed' && !values.fixedUntil) {
    throw invalid('fixedUntil', 'a mixed rate needs the date the fixed period ends');
  }
  if (values.firstDueDate < values.startDate) {
    throw invalid('firstDueDate', 'cannot be before the start date');
  }
  return values;
}

/** The property and the debit account must be the pool's own (composite foreign keys repeat it). */
async function assertRefs(tx: PoolTx, ctx: PoolContext, values: LoanValues) {
  if (values.propertyId && !(await propertiesRepo.find(tx, ctx, values.propertyId))) {
    throw invalid('propertyId', 'not a property of this pool');
  }
  if (values.debitAccountId && !(await accountsRepo.find(tx, ctx, values.debitAccountId))) {
    throw invalid('debitAccountId', 'not an account of this pool');
  }
}

const defaultFields = (): (LoanFieldValues & { id: string })[] =>
  BUILTIN_LOAN_FIELDS.map((key) => ({
    id: newId(),
    key,
    label: BUILTIN_LABELS[key],
    kind: 'builtin',
    enabled: (DEFAULT_ENABLED_LOAN_FIELDS as readonly string[]).includes(key),
    countsAsExpense: true,
    defaultAmount: null,
    appliesFrom: null,
  }));

/** The plan of a loan; events that cannot work together (an installment below the interest) answer 400. */
function projectOrRefuse(
  loan: LoanRow,
  events: readonly LoanEvent[],
  actual: readonly InstallmentAmounts[],
) {
  try {
    return projectLoan({
      principal: loan.principal,
      annualPct: loan.annualRate,
      termMonths: loan.termMonths,
      firstDueDate: loan.firstDueDate,
      events,
      actual,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw invalid('events', 'the events cannot be applied to this loan');
    }
    throw error;
  }
}

export function createLoansService(deps: LoansServiceDeps): LoansService {
  const { auth, identity, entitlements } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);
  const now = deps.now ?? (() => new Date());
  const today = () => now().toISOString().slice(0, 10);

  async function membership(
    session: Awaited<ReturnType<typeof requireSession>>,
    poolId: string,
    permission: Permission,
  ) {
    const ctx = await requirePoolAccess(identity, session, poolId);
    can(ctx, permission);
    await entitlements.assertFeature(ctx, 'real_estate');
    return ctx;
  }

  async function guard(headers: Headers, poolId: string, permission: Permission) {
    return membership(await requireSession(auth, headers), poolId, permission);
  }

  /** The loans as DTOs from one load of fields and installments. */
  async function view(tx: PoolTx, ctx: PoolContext, only?: string) {
    const rows = (await loansRepo.list(tx, ctx)).filter((row) => !only || row.id === only);
    const ids = rows.map((row) => row.id);
    const fields = await loansRepo.listFields(tx, ctx, ids);
    const result = [];
    for (const row of rows) {
      const own = fields.filter((field) => field.loanId === row.id);
      const installments = await loansRepo.listInstallments(tx, ctx, row.id);
      const amounts = await loansRepo.listAmounts(
        tx,
        ctx,
        installments.map((item) => item.id),
      );
      const events = await loanEventsRepo.list(tx, ctx, row.id);
      const prepaid = sum(
        events
          .filter((event) => event.kind === 'prepayment' && event.date <= today())
          .map((event) => event.amount ?? 0),
      );
      result.push(
        toLoanDto(
          row,
          own,
          installments.map((item) => toAmounts(item, amounts, own)),
          toPlain(prepaid),
        ),
      );
    }
    return result;
  }

  async function one(tx: PoolTx, ctx: PoolContext, id: string): Promise<LoanDto> {
    const found = (await view(tx, ctx, id))[0];
    if (!found) throw new NotFoundError();
    return LoanDto.parse(found);
  }

  async function installmentDto(tx: PoolTx, ctx: PoolContext, loanId: string, id: string) {
    const [row, fields] = await Promise.all([
      loansRepo.findInstallment(tx, ctx, loanId, id),
      loansRepo.listFields(tx, ctx, [loanId]),
    ]);
    if (!row) throw new NotFoundError();
    const amounts = await loansRepo.listAmounts(tx, ctx, [row.id]);
    return InstallmentDto.parse(toInstallmentDto(row, amounts, fields));
  }

  /** Custom amounts by field key → field ids; an unknown key is a client error. */
  async function customAmounts(
    tx: PoolTx,
    ctx: PoolContext,
    loanId: string,
    custom: Record<string, string> | undefined,
  ) {
    const fields = await loansRepo.listFields(tx, ctx, [loanId]);
    return Object.entries(custom ?? {}).map(([key, amount]) => {
      const field = fields.find(
        (candidate) => candidate.key === key && candidate.kind === 'custom',
      );
      if (!field) throw invalid(`custom.${key}`, 'not a custom field of this loan');
      return { fieldId: field.id, amount };
    });
  }

  /** The row to store: what the request sets over what the installment already had. */
  const installmentValues = (
    data: UpdateInstallmentInput & { number?: number },
    base?: InstallmentValues,
  ): InstallmentValues => ({
    number: data.number ?? base?.number ?? 1,
    dueDate: data.dueDate ?? base?.dueDate ?? '',
    capital: data.capital ?? base?.capital ?? ZERO,
    interest: data.interest ?? base?.interest ?? ZERO,
    fees: data.fees ?? base?.fees ?? ZERO,
    stampTax: data.stampTax ?? base?.stampTax ?? ZERO,
    lifeInsurance: data.lifeInsurance ?? base?.lifeInsurance ?? ZERO,
    homeInsurance: data.homeInsurance ?? base?.homeInsurance ?? ZERO,
    creditInsurance: data.creditInsurance ?? base?.creditInsurance ?? ZERO,
    status: data.status ?? base?.status ?? 'paid',
    source: base?.source ?? 'manual',
  });

  return {
    async list(headers, poolId) {
      const ctx = await guard(headers, poolId, 'pool.read');
      return LoanListDto.parse({ loans: await run(ctx, (tx) => view(tx, ctx)) });
    },

    async get(headers, poolId, id) {
      const ctx = await guard(headers, poolId, 'pool.read');
      const loanId = parseId(id);
      return run(ctx, (tx) => one(tx, ctx, loanId));
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateLoanInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const data = parsed.data;
      const values = assertTerms({
        name: data.name,
        kind: data.kind,
        propertyId: data.propertyId ?? null,
        principal: data.principal,
        startDate: data.startDate,
        firstDueDate: data.firstDueDate,
        termMonths: data.termMonths,
        rateType: data.rateType,
        rateIndex: data.rateIndex ?? null,
        spread: data.spread ?? null,
        annualRate: data.annualRate,
        fixedUntil: data.fixedUntil ?? null,
        reviewMonths: data.reviewMonths ?? null,
        paymentDay: data.paymentDay,
        debitAccountId: data.debitAccountId ?? null,
        taeg: data.taeg ?? null,
        tan: data.tan ?? null,
      });
      const id = newId();
      const dto = await run(ctx, async (tx) => {
        await assertRefs(tx, ctx, values);
        await loansRepo.insert(tx, ctx, id, values);
        await loansRepo.insertFields(tx, ctx, id, defaultFields());
        return one(tx, ctx, id);
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'loan.created', { target: id, ip: ipOf(headers) });
      return dto;
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateLoanInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const loanId = parseId(id);
      const patch = parsed.data;
      const dto = await run(ctx, async (tx) => {
        const current = await loansRepo.find(tx, ctx, loanId);
        if (!current) throw new NotFoundError();
        const pick = <T>(next: T | undefined, now: T): T => (next === undefined ? now : next);
        const values = assertTerms({
          name: pick(patch.name, current.name),
          kind: pick(patch.kind, current.kind),
          propertyId: pick(patch.propertyId, current.propertyId),
          principal: pick(patch.principal, current.principal),
          startDate: pick(patch.startDate, current.startDate),
          firstDueDate: pick(patch.firstDueDate, current.firstDueDate),
          termMonths: pick(patch.termMonths, current.termMonths),
          rateType: pick(patch.rateType, current.rateType),
          rateIndex: pick(patch.rateIndex, current.rateIndex),
          spread: pick(patch.spread, current.spread),
          annualRate: pick(patch.annualRate, current.annualRate),
          fixedUntil: pick(patch.fixedUntil, current.fixedUntil),
          reviewMonths: pick(patch.reviewMonths, current.reviewMonths),
          paymentDay: pick(patch.paymentDay, current.paymentDay),
          debitAccountId: pick(patch.debitAccountId, current.debitAccountId),
          taeg: pick(patch.taeg, current.taeg),
          tan: pick(patch.tan, current.tan),
        });
        await assertRefs(tx, ctx, values);
        await loansRepo.update(tx, ctx, loanId, values);
        return one(tx, ctx, loanId);
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'loan.updated', { target: loanId, ip: ipOf(headers) });
      return dto;
    },

    async remove(headers, poolId, id) {
      const ctx = await guard(headers, poolId, 'realestate.write');
      const loanId = parseId(id);
      const removed = await run(ctx, (tx) => loansRepo.remove(tx, ctx, loanId));
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'loan.deleted', { target: loanId, ip: ipOf(headers) });
    },

    async schedule(headers, poolId, id) {
      const ctx = await guard(headers, poolId, 'pool.read');
      const loanId = parseId(id);
      return run(ctx, async (tx) => {
        const loan = await loansRepo.find(tx, ctx, loanId);
        if (!loan) throw new NotFoundError();
        const fields = await loansRepo.listFields(tx, ctx, [loanId]);
        const installments = await loansRepo.listInstallments(tx, ctx, loanId);
        const amounts = await loansRepo.listAmounts(
          tx,
          ctx,
          installments.map((item) => item.id),
        );
        const actual = installments.map((item) => toAmounts(item, amounts, fields));
        const events = (await loanEventsRepo.list(tx, ctx, loanId)).map(toDomainEvent);
        const plan = projectOrRefuse(loan, events, actual);
        return ScheduleDto.parse({
          schedule: plan.rows.map(({ annualPct, ...row }) => ({ ...row, annualRate: annualPct })),
          byYear: totalsByContractYear(actual, fieldSettings(fields)),
        });
      });
    },

    async listInstallments(headers, poolId, id) {
      const ctx = await guard(headers, poolId, 'pool.read');
      const loanId = parseId(id);
      return run(ctx, async (tx) => {
        if (!(await loansRepo.find(tx, ctx, loanId))) throw new NotFoundError();
        const fields = await loansRepo.listFields(tx, ctx, [loanId]);
        const rows = await loansRepo.listInstallments(tx, ctx, loanId);
        const amounts = await loansRepo.listAmounts(
          tx,
          ctx,
          rows.map((row) => row.id),
        );
        return InstallmentListDto.parse({
          installments: rows.map((row) => toInstallmentDto(row, amounts, fields)),
        });
      });
    },

    async addInstallment(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateInstallmentInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const loanId = parseId(id);
      const installmentId = newId();
      const dto = await run(ctx, async (tx) => {
        const loan = await loansRepo.find(tx, ctx, loanId);
        if (!loan) throw new NotFoundError();
        if (parsed.data.number > loan.termMonths) {
          throw invalid('number', 'is beyond the term of the loan');
        }
        const custom = await customAmounts(tx, ctx, loanId, parsed.data.custom);
        await loansRepo.insertInstallment(
          tx,
          ctx,
          loanId,
          installmentId,
          installmentValues(parsed.data),
        );
        await loansRepo.replaceAmounts(tx, ctx, installmentId, custom);
        return installmentDto(tx, ctx, loanId, installmentId);
      }).catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ConflictError('This loan already has that installment.');
        }
        return refOrRethrow(error);
      });
      await recordAudit(identity, ctx, 'loan.installment_added', {
        target: loanId,
        ip: ipOf(headers),
      });
      return dto;
    },

    async updateInstallment(headers, poolId, id, installmentId, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateInstallmentInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const loanId = parseId(id);
      const rowId = parseId(installmentId);
      const dto = await run(ctx, async (tx) => {
        const current = await loansRepo.findInstallment(tx, ctx, loanId, rowId);
        if (!current) throw new NotFoundError();
        const custom = parsed.data.custom
          ? await customAmounts(tx, ctx, loanId, parsed.data.custom)
          : undefined;
        await loansRepo.updateInstallment(
          tx,
          ctx,
          loanId,
          rowId,
          installmentValues(parsed.data, current),
        );
        if (custom) await loansRepo.replaceAmounts(tx, ctx, rowId, custom);
        return installmentDto(tx, ctx, loanId, rowId);
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'loan.installment_updated', {
        target: loanId,
        ip: ipOf(headers),
      });
      return dto;
    },

    async removeInstallment(headers, poolId, id, installmentId) {
      const ctx = await guard(headers, poolId, 'realestate.write');
      const loanId = parseId(id);
      const rowId = parseId(installmentId);
      const removed = await run(ctx, (tx) => loansRepo.removeInstallment(tx, ctx, loanId, rowId));
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'loan.installment_deleted', {
        target: loanId,
        ip: ipOf(headers),
      });
    },

    async linkInstallment(headers, poolId, id, installmentId, input) {
      const session = await requireSession(auth, headers);
      const parsed = LinkInstallmentInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const loanId = parseId(id);
      const rowId = parseId(installmentId);
      const link = await run(ctx, async (tx) => {
        const row = await loansRepo.findInstallment(tx, ctx, loanId, rowId);
        if (!row) throw new NotFoundError();
        if (await transactionsRepo.findByInstallment(tx, ctx, rowId)) {
          throw new ConflictError('This installment is already linked to a movement.');
        }
        const movement = await transactionsRepo.find(tx, ctx, parsed.data.transactionId);
        if (!movement) throw invalid('transactionId', 'not a movement of this pool');
        if (!dec(movement.amount).isNegative() || movement.transfer) {
          throw invalid('transactionId', 'must be a debit that is not a transfer');
        }
        if (movement.loanInstallmentId) {
          throw new ConflictError('That movement already pays another installment.');
        }
        await transactionsRepo.setLoanInstallment(tx, ctx, movement.id, rowId);
        const fields = await loansRepo.listFields(tx, ctx, [loanId]);
        const custom = await loansRepo.listAmounts(tx, ctx, [rowId]);
        return InstallmentLinkDto.parse({
          installmentId: rowId,
          transactionId: movement.id,
          split: installmentCostSplit(toAmounts(row, custom, fields), fieldSettings(fields)),
        });
      }).catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ConflictError('This installment is already linked to a movement.');
        }
        return refOrRethrow(error);
      });
      await recordAudit(identity, ctx, 'loan.installment_linked', {
        target: loanId,
        ip: ipOf(headers),
      });
      return link;
    },

    async unlinkInstallment(headers, poolId, id, installmentId) {
      const ctx = await guard(headers, poolId, 'realestate.write');
      const loanId = parseId(id);
      const rowId = parseId(installmentId);
      await run(ctx, async (tx) => {
        if (!(await loansRepo.findInstallment(tx, ctx, loanId, rowId))) throw new NotFoundError();
        const linked = await transactionsRepo.findByInstallment(tx, ctx, rowId);
        if (!linked) throw invalid('installmentId', 'the installment has no link');
        await transactionsRepo.setLoanInstallment(tx, ctx, linked.id, null);
      });
      await recordAudit(identity, ctx, 'loan.installment_unlinked', {
        target: loanId,
        ip: ipOf(headers),
      });
    },

    async matchInstallments(headers, poolId, id) {
      const ctx = await guard(headers, poolId, 'realestate.write');
      const loanId = parseId(id);
      const result = await run(ctx, async (tx) => {
        const loan = await loansRepo.find(tx, ctx, loanId);
        if (!loan) throw new NotFoundError();
        if (!loan.debitAccountId) throw invalid('debitAccountId', 'set the debit account first');
        const rows = await loansRepo.listInstallments(tx, ctx, loanId);
        const linked = await transactionsRepo.linkedInstallmentIds(
          tx,
          ctx,
          rows.map((row) => row.id),
        );
        const open = rows.filter((row) => !linked.has(row.id));
        const first = open[0];
        const last = open[open.length - 1];
        if (!first || !last) return MatchResultDto.parse({ matched: [] });
        const fields = await loansRepo.listFields(tx, ctx, [loanId]);
        const custom = await loansRepo.listAmounts(
          tx,
          ctx,
          open.map((row) => row.id),
        );
        const debits = await transactionsRepo.listUnlinkedDebits(
          tx,
          ctx,
          loan.debitAccountId,
          addDays(first.dueDate, -MATCH_DAYS),
          addDays(last.dueDate, MATCH_DAYS),
        );
        const matched = matchInstallments(
          open.map((row) => ({
            id: row.id,
            dueDate: row.dueDate,
            total: installmentTotal(toAmounts(row, custom, fields), fieldSettings(fields)),
          })),
          debits,
        );
        for (const pair of matched) {
          await transactionsRepo.setLoanInstallment(
            tx,
            ctx,
            pair.transactionId,
            pair.installmentId,
          );
        }
        return MatchResultDto.parse({ matched });
      });
      await recordAudit(identity, ctx, 'loan.installments_matched', {
        target: loanId,
        ip: ipOf(headers),
      });
      return result;
    },

    async listEvents(headers, poolId, id) {
      const ctx = await guard(headers, poolId, 'pool.read');
      const loanId = parseId(id);
      return run(ctx, async (tx) => {
        const loan = await loansRepo.find(tx, ctx, loanId);
        if (!loan) throw new NotFoundError();
        const rows = await loanEventsRepo.list(tx, ctx, loanId);
        const events = rows.map(toDomainEvent);
        const impacts = projectOrRefuse(loan, events, []).impacts;
        return EventListDto.parse({
          events: rows.map((row, index) =>
            toEventDto(
              row,
              impacts.find((impact) => impact.event === index),
            ),
          ),
        });
      });
    },

    async addEvent(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateEventInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const loanId = parseId(id);
      const data = parsed.data;
      const effectiveFrom = data.effectiveFrom ?? defaultEffectiveFrom(data.kind, data.date);
      if (effectiveFrom < data.date) {
        throw invalid('effectiveFrom', 'cannot be before the date of the event');
      }
      const eventId = newId();
      const dto = await run(ctx, async (tx) => {
        const loan = await loansRepo.find(tx, ctx, loanId);
        if (!loan) throw new NotFoundError();
        const row = await loanEventsRepo.insert(tx, ctx, loanId, eventId, {
          kind: data.kind,
          date: data.date,
          effectiveFrom,
          amount: data.kind === 'prepayment' ? data.amount : null,
          fee: data.kind === 'prepayment' ? (data.fee ?? ZERO) : null,
          effect: data.kind === 'prepayment' ? data.effect : null,
          indexValue: data.kind === 'rate_review' ? (data.indexValue ?? null) : null,
          spread: data.kind === 'prepayment' ? null : (data.spread ?? null),
          annualRate: data.kind === 'prepayment' ? null : (data.annualRate ?? null),
          newInstallment: data.kind === 'prepayment' ? null : (data.newInstallment ?? null),
          termMonths: data.kind === 'renegotiation' ? (data.termMonths ?? null) : null,
        });
        // The loan must still work with the new event in it (a replay refuses the impossible ones).
        const rows = await loanEventsRepo.list(tx, ctx, loanId);
        const plan = projectOrRefuse(loan, rows.map(toDomainEvent), []);
        const at = rows.findIndex((candidate) => candidate.id === row.id);
        return toEventDto(
          row,
          plan.impacts.find((impact) => impact.event === at),
        );
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'loan.event_added', { target: loanId, ip: ipOf(headers) });
      return EventDto.parse(dto);
    },

    async removeEvent(headers, poolId, id, eventId) {
      const ctx = await guard(headers, poolId, 'realestate.write');
      const loanId = parseId(id);
      const rowId = parseId(eventId);
      const removed = await run(ctx, (tx) => loanEventsRepo.remove(tx, ctx, loanId, rowId));
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'loan.event_deleted', {
        target: loanId,
        ip: ipOf(headers),
      });
    },

    async reviewPreview(headers, poolId, id) {
      const ctx = await guard(headers, poolId, 'pool.read');
      const loanId = parseId(id);
      return run(ctx, async (tx) => {
        const loan = await loansRepo.find(tx, ctx, loanId);
        if (!loan) throw new NotFoundError();
        if (loan.rateType === 'fixed' || !loan.rateIndex) {
          throw invalid('rateType', 'only a variable or mixed rate has reviews');
        }
        const fields = await loansRepo.listFields(tx, ctx, [loanId]);
        const installments = await loansRepo.listInstallments(tx, ctx, loanId);
        const amounts = await loansRepo.listAmounts(
          tx,
          ctx,
          installments.map((item) => item.id),
        );
        const eventRows = await loanEventsRepo.list(tx, ctx, loanId);
        const events = eventRows.map(toDomainEvent);
        const plan = projectOrRefuse(
          loan,
          events,
          installments.map((item) => toAmounts(item, amounts, fields)),
        );
        const left = plan.rows.filter((row) => row.source === 'projected');
        const next = left[0];
        if (!next) throw new ConflictError('This loan has nothing left to pay.');
        const latest = await indexRatesRepo.latest(tx, loan.rateIndex);
        const spread = loan.spread ?? ZERO;
        const newRate = latest ? reviewedRate(latest.rate, spread) : null;
        const reviews = eventRows.filter((event) => event.kind !== 'prepayment');
        const anchor =
          reviews.at(-1)?.effectiveFrom ??
          (loan.rateType === 'mixed' ? loan.fixedUntil : null) ??
          loan.firstDueDate;
        return ReviewPreviewDto.parse({
          rateIndex: loan.rateIndex,
          indexPeriod: latest?.period ?? null,
          indexValue: latest?.rate ?? null,
          spread,
          currentRate: next.annualPct,
          newRate,
          outstanding: plan.outstanding,
          remainingInstallments: left.length,
          currentPayment: next.payment,
          newPayment: newRate ? reviewPreview(plan.outstanding, newRate, left.length) : null,
          nextReviewDate: nextReviewDate(anchor, loan.reviewMonths, today()),
        });
      });
    },

    async addField(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateFieldInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const loanId = parseId(id);
      const fieldId = newId();
      const row = await run(ctx, async (tx) => {
        if (!(await loansRepo.find(tx, ctx, loanId))) throw new NotFoundError();
        await loansRepo.insertFields(tx, ctx, loanId, [
          {
            id: fieldId,
            key: parsed.data.key,
            label: parsed.data.label,
            kind: 'custom',
            enabled: true,
            countsAsExpense: parsed.data.countsAsExpense ?? true,
            defaultAmount: parsed.data.defaultAmount ?? null,
            appliesFrom: null,
          },
        ]);
        const fields = await loansRepo.listFields(tx, ctx, [loanId]);
        return fields.find((field) => field.id === fieldId);
      }).catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ConflictError('This loan already has a field with that key.');
        }
        throw error;
      });
      if (!row) throw new NotFoundError();
      await recordAudit(identity, ctx, 'loan.field_created', { target: loanId, ip: ipOf(headers) });
      return LoanFieldDto.parse(toFieldDto(row));
    },

    async updateField(headers, poolId, id, key, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateFieldInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const loanId = parseId(id);
      const row = await run(ctx, async (tx) => {
        const fields = await loansRepo.listFields(tx, ctx, [loanId]);
        const current = fields.find((field) => field.key === key);
        if (!current) throw new NotFoundError();
        const patch = parsed.data;
        return loansRepo.updateField(tx, ctx, loanId, key, {
          label: patch.label ?? current.label,
          enabled: patch.enabled ?? current.enabled,
          countsAsExpense: patch.countsAsExpense ?? current.countsAsExpense,
          defaultAmount:
            patch.defaultAmount === undefined ? current.defaultAmount : patch.defaultAmount,
          appliesFrom: patch.appliesFrom === undefined ? current.appliesFrom : patch.appliesFrom,
        });
      });
      if (!row) throw new NotFoundError();
      await recordAudit(identity, ctx, 'loan.field_updated', { target: loanId, ip: ipOf(headers) });
      return LoanFieldDto.parse(toFieldDto(row));
    },
  };
}
