import {
  accountsRepo,
  loansRepo,
  newId,
  propertiesRepo,
  propertyCostsRepo,
  transactionsRepo,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
  type PropertyCostRow,
  type PropertyCostValues,
} from '@nestvault/db';
import {
  addDays,
  addMonths,
  costOccurrences,
  costTotals,
  dec,
  dueDates,
  expectedByMonth,
  isDueDate,
  occurrenceKey,
  type CostInput,
  type InstallmentInsurance,
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
  CostDto,
  CostListDto,
  CostTotalsDto,
  CostTotalsQuery,
  CreateCostInput,
  DueDate,
  LinkCostPaymentInput,
  CostPaymentDto,
  toCostDto,
  toOccurrenceDto,
  UpcomingCostsDto,
  UpcomingCostsQuery,
  UpdateCostInput,
} from './schemas';

export interface PropertyCostsService {
  /** The pool's recurring property costs; `propertyId` narrows it (`pool.read`, Pro). */
  list(headers: Headers, poolId: string, propertyId?: string): Promise<CostListDto>;
  /** One cost (`pool.read`, Pro). */
  get(headers: Headers, poolId: string, id: string): Promise<CostDto>;
  /** Adds a cost to a property (`realestate.write`, Pro). */
  create(headers: Headers, poolId: string, input: unknown): Promise<CostDto>;
  /** Changes a cost; fields left out stay (`realestate.write`, Pro). */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<CostDto>;
  /** Deletes a cost with the occurrences it paid (`realestate.write`, Pro). */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
  /** The occurrences still expected, by month, for the month forecast (`pool.read`, Pro). */
  upcoming(headers: Headers, poolId: string, query?: unknown): Promise<UpcomingCostsDto>;
  /** What the properties cost in a period, with the installment insurances counted once (`pool.read`, Pro). */
  totals(headers: Headers, poolId: string, query?: unknown): Promise<CostTotalsDto>;
  /** Marks an occurrence paid by a bank debit (`realestate.write`, Pro). */
  linkPayment(
    headers: Headers,
    poolId: string,
    id: string,
    dueDate: string,
    input: unknown,
  ): Promise<CostPaymentDto>;
  /** Takes the link away; the occurrence is expected again (`realestate.write`, Pro). */
  unlinkPayment(headers: Headers, poolId: string, id: string, dueDate: string): Promise<void>;
}

export interface PropertyCostsServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Property costs are a Pro feature (ADR 0003). */
  entitlements: Entitlements;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  /** The clock, for "from today" and the default period; tests pin it. */
  now?: () => Date;
  trustedProxyHops?: number;
}

type Permission = 'pool.read' | 'realestate.write';

const INTERVAL_OF = { monthly: 1, annual: 12 } as const;

/** Longest period `totals` answers, so the occurrences it builds stay small. */
const MAX_PERIOD_MONTHS = 60;

/** The keys of the loan fields that hold an insurance. */
type InsuranceField = 'homeInsurance' | 'lifeInsurance' | 'creditInsurance';

const asInput = (row: PropertyCostRow): CostInput => ({
  id: row.id,
  propertyId: row.propertyId,
  kind: row.kind as CostInput['kind'],
  amount: row.amount,
  intervalMonths: row.intervalMonths,
  startDate: row.startDate,
  endDate: row.endDate,
});

/** Cross-field rules of a cost (the check constraints repeat the single-column ones). */
function assertShape(values: PropertyCostValues): PropertyCostValues {
  if (values.kind === 'other' && !values.name) throw invalid('name', 'is required for other costs');
  if (values.endDate && values.endDate < values.startDate) {
    throw invalid('endDate', 'cannot be before the start date');
  }
  return values;
}

/** The interval a periodicity means; `custom` needs the months, the others must not have them. */
function intervalOf(periodicity: string, intervalMonths: number | undefined): number {
  if (periodicity === 'custom') {
    if (intervalMonths === undefined) throw invalid('intervalMonths', 'is required for custom');
    return intervalMonths;
  }
  if (intervalMonths !== undefined) throw invalid('intervalMonths', 'is only for custom');
  return INTERVAL_OF[periodicity as keyof typeof INTERVAL_OF];
}

export function createPropertyCostsService(deps: PropertyCostsServiceDeps): PropertyCostsService {
  const { auth, identity, entitlements } = deps;
  const run = deps.run ?? withPool;
  const now = deps.now ?? (() => new Date());
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);
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

  async function cost(tx: PoolTx, ctx: PoolContext, id: string): Promise<PropertyCostRow> {
    const row = await propertyCostsRepo.find(tx, ctx, id);
    if (!row) throw new NotFoundError();
    return row;
  }

  function dto(row: PropertyCostRow): CostDto {
    const from = today();
    const next = dueDates(asInput(row), from, addMonths(from, row.intervalMonths))[0] ?? null;
    return CostDto.parse(toCostDto(row, next));
  }

  /** The insurances inside the installments of the loans of a property (all properties when none). */
  async function installmentInsurance(
    tx: PoolTx,
    ctx: PoolContext,
    propertyId?: string,
  ): Promise<InstallmentInsurance[]> {
    const loans = (await loansRepo.list(tx, ctx)).filter(
      (loan) => loan.propertyId && (!propertyId || loan.propertyId === propertyId),
    );
    const fields = await loansRepo.listFields(
      tx,
      ctx,
      loans.map((loan) => loan.id),
    );
    const rows: InstallmentInsurance[] = [];
    for (const loan of loans) {
      // A disabled field keeps its values but adds up to nothing (loans domain).
      const on = new Set(
        fields.filter((field) => field.loanId === loan.id && field.enabled).map((f) => f.key),
      );
      const amountOf = (key: InsuranceField, value: string) => (on.has(key) ? value : '0');
      for (const row of await loansRepo.listInstallments(tx, ctx, loan.id)) {
        rows.push({
          propertyId: loan.propertyId as string,
          dueDate: row.dueDate,
          home: amountOf('homeInsurance', row.homeInsurance),
          life: amountOf('lifeInsurance', row.lifeInsurance),
          credit: amountOf('creditInsurance', row.creditInsurance),
        });
      }
    }
    return rows;
  }

  /** The occurrences of the costs in a period, with what is paid and what an installment covers. */
  async function occurrences(
    tx: PoolTx,
    ctx: PoolContext,
    costs: readonly PropertyCostRow[],
    from: string,
    to: string,
    installments: readonly InstallmentInsurance[],
  ) {
    const payments = await propertyCostsRepo.listPayments(
      tx,
      ctx,
      costs.map((row) => row.id),
    );
    const paid = new Map(
      payments.map((row) => [occurrenceKey(row.costId, row.dueDate), row.transactionId]),
    );
    const names = new Map(costs.map((row) => [row.id, row.name]));
    return costOccurrences(costs.map(asInput), from, to, {
      paid: new Set(paid.keys()),
      installments,
    }).map((row) =>
      toOccurrenceDto(
        row,
        names.get(row.costId) ?? null,
        paid.get(occurrenceKey(row.costId, row.dueDate)) ?? null,
      ),
    );
  }

  return {
    async list(headers, poolId, propertyId) {
      const ctx = await guard(headers, poolId, 'pool.read');
      const filter = propertyId === undefined ? undefined : parseId(propertyId);
      return run(ctx, async (tx) =>
        CostListDto.parse({ costs: (await propertyCostsRepo.list(tx, ctx, filter)).map(dto) }),
      );
    },

    async get(headers, poolId, id) {
      const ctx = await guard(headers, poolId, 'pool.read');
      const costId = parseId(id);
      return run(ctx, async (tx) => dto(await cost(tx, ctx, costId)));
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateCostInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const data = parsed.data;
      const values = assertShape({
        propertyId: data.propertyId,
        kind: data.kind,
        name: data.name ?? null,
        amount: data.amount,
        periodicity: data.periodicity,
        intervalMonths: intervalOf(data.periodicity, data.intervalMonths),
        startDate: data.startDate,
        endDate: data.endDate ?? null,
        accountId: data.accountId ?? null,
      });
      const id = newId();
      const created = await run(ctx, async (tx) => {
        if (!(await propertiesRepo.find(tx, ctx, values.propertyId))) {
          throw invalid('propertyId', 'not a property of this pool');
        }
        if (values.accountId && !(await accountsRepo.find(tx, ctx, values.accountId))) {
          throw invalid('accountId', 'not an account of this pool');
        }
        return dto(await propertyCostsRepo.insert(tx, ctx, id, values));
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'cost.created', { target: id, ip: ipOf(headers) });
      return created;
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateCostInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const costId = parseId(id);
      const patch = parsed.data;
      const updated = await run(ctx, async (tx) => {
        const current = await cost(tx, ctx, costId);
        const pick = <T>(next: T | undefined, now: T): T => (next === undefined ? now : next);
        const periodicity = pick(patch.periodicity, current.periodicity);
        // A new periodicity brings its own interval; the same one keeps the stored interval.
        const interval =
          patch.periodicity === undefined && patch.intervalMonths === undefined
            ? current.intervalMonths
            : intervalOf(periodicity, patch.intervalMonths);
        const values = assertShape({
          propertyId: current.propertyId,
          kind: pick(patch.kind, current.kind),
          name: pick(patch.name, current.name),
          amount: pick(patch.amount, current.amount),
          periodicity,
          intervalMonths: interval,
          startDate: pick(patch.startDate, current.startDate),
          endDate: pick(patch.endDate, current.endDate),
          accountId: pick(patch.accountId, current.accountId),
        });
        if (values.accountId && !(await accountsRepo.find(tx, ctx, values.accountId))) {
          throw invalid('accountId', 'not an account of this pool');
        }
        const row = await propertyCostsRepo.update(tx, ctx, costId, values);
        if (!row) throw new NotFoundError();
        return dto(row);
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'cost.updated', { target: costId, ip: ipOf(headers) });
      return updated;
    },

    async remove(headers, poolId, id) {
      const ctx = await guard(headers, poolId, 'realestate.write');
      const costId = parseId(id);
      const removed = await run(ctx, (tx) => propertyCostsRepo.remove(tx, ctx, costId));
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'cost.deleted', { target: costId, ip: ipOf(headers) });
    },

    async upcoming(headers, poolId, query) {
      const parsed = UpcomingCostsQuery.safeParse(query ?? {});
      if (!parsed.success) throw zodProblem(parsed.error, query);
      const ctx = await guard(headers, poolId, 'pool.read');
      // From the first of this month, so a cost due earlier this month and not yet paid still shows.
      const from = `${today().slice(0, 7)}-01`;
      const to = addDays(addMonths(from, parsed.data.months), -1);
      return run(ctx, async (tx) => {
        const costs = await propertyCostsRepo.list(tx, ctx);
        const rows = await occurrences(
          tx,
          ctx,
          costs,
          from,
          to,
          await installmentInsurance(tx, ctx),
        );
        return UpcomingCostsDto.parse({ months: expectedByMonth(rows) });
      });
    },

    async totals(headers, poolId, query) {
      const parsed = CostTotalsQuery.safeParse(query ?? {});
      if (!parsed.success) throw zodProblem(parsed.error, query);
      const ctx = await guard(headers, poolId, 'pool.read');
      const year = today().slice(0, 4);
      const from = parsed.data.from ?? `${year}-01-01`;
      const to = parsed.data.to ?? `${year}-12-31`;
      if (to < from) throw invalid('to', 'cannot be before from');
      if (addMonths(from, MAX_PERIOD_MONTHS) < to) {
        throw invalid('to', `the period is at most ${MAX_PERIOD_MONTHS} months`);
      }
      const propertyId = parsed.data.propertyId;
      return run(ctx, async (tx) => {
        const costs = await propertyCostsRepo.list(tx, ctx, propertyId);
        const installments = await installmentInsurance(tx, ctx, propertyId);
        const rows = await occurrences(tx, ctx, costs, from, to, installments);
        const totals = costTotals(rows, installments, from, to);
        return CostTotalsDto.parse({
          propertyId: propertyId ?? null,
          from,
          to,
          byKind: totals.byKind,
          costs: totals.costs,
          paid: totals.paid,
          expected: totals.expected,
          installmentInsurance: totals.installmentInsurance,
          total: totals.total,
          occurrences: rows,
        });
      });
    },

    async linkPayment(headers, poolId, id, dueDate, input) {
      const session = await requireSession(auth, headers);
      const date = DueDate.safeParse(dueDate);
      if (!date.success) throw zodProblem(date.error, dueDate);
      const parsed = LinkCostPaymentInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const costId = parseId(id);
      const paymentId = newId();
      const linked = await run(ctx, async (tx) => {
        const current = await cost(tx, ctx, costId);
        if (!isDueDate(asInput(current), date.data)) {
          throw invalid('dueDate', 'not a due date of this cost');
        }
        if (await propertyCostsRepo.findPayment(tx, ctx, costId, date.data)) {
          throw new ConflictError('This occurrence is already linked to a movement.');
        }
        const movement = await transactionsRepo.find(tx, ctx, parsed.data.transactionId);
        if (!movement) throw invalid('transactionId', 'not a movement of this pool');
        if (!dec(movement.amount).isNegative() || movement.transfer) {
          throw invalid('transactionId', 'must be a debit that is not a transfer');
        }
        const row = await propertyCostsRepo.insertPayment(
          tx,
          ctx,
          paymentId,
          costId,
          date.data,
          movement.id,
        );
        return CostPaymentDto.parse({
          costId: row.costId,
          dueDate: row.dueDate,
          transactionId: row.transactionId,
        });
      }).catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ConflictError('That movement already pays another occurrence.');
        }
        return refOrRethrow(error);
      });
      await recordAudit(identity, ctx, 'cost.payment_linked', {
        target: costId,
        ip: ipOf(headers),
      });
      return linked;
    },

    async unlinkPayment(headers, poolId, id, dueDate) {
      const session = await requireSession(auth, headers);
      const date = DueDate.safeParse(dueDate);
      if (!date.success) throw zodProblem(date.error, dueDate);
      const ctx = await membership(session, poolId, 'realestate.write');
      const costId = parseId(id);
      const removed = await run(ctx, (tx) =>
        propertyCostsRepo.removePayment(tx, ctx, costId, date.data),
      );
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'cost.payment_unlinked', {
        target: costId,
        ip: ipOf(headers),
      });
    },
  };
}
