import {
  categoriesRepo,
  newId,
  propertiesRepo,
  transactionsRepo,
  withPool,
  worksRepo,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
  type WorksPaymentValues,
  type WorksProjectRow,
  type WorksProjectValues,
} from '@nestvault/db';
import { dec, propertyWorkTotals, upcomingByMonth } from '@nestvault/domain';

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
  CreatePaymentInput,
  CreateWorkInput,
  LinkTransactionInput,
  PaymentDto,
  toPaymentDto,
  toWorkDto,
  UpcomingDto,
  UpdatePaymentInput,
  UpdateWorkInput,
  WorkDto,
  WorkListDto,
} from './schemas';

export interface WorksService {
  /** The pool's works projects with their phases, and the totals per property (`pool.read`, Pro). */
  list(headers: Headers, poolId: string, propertyId?: string): Promise<WorkListDto>;
  /** One project (`pool.read`, Pro). */
  get(headers: Headers, poolId: string, id: string): Promise<WorkDto>;
  /** Opens a project on a property (`realestate.write`, Pro). */
  create(headers: Headers, poolId: string, input: unknown): Promise<WorkDto>;
  /** Changes a project; fields left out stay (`realestate.write`, Pro). */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<WorkDto>;
  /** Deletes a project with its phases (`realestate.write`, Pro). */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
  /** The phases still to pay, by the month they are planned for (`pool.read`, Pro). */
  upcoming(headers: Headers, poolId: string): Promise<UpcomingDto>;
  /** Adds a payment phase (`realestate.write`, Pro). */
  addPayment(headers: Headers, poolId: string, id: string, input: unknown): Promise<PaymentDto>;
  /** Corrects a phase (`realestate.write`, Pro). */
  updatePayment(
    headers: Headers,
    poolId: string,
    id: string,
    paymentId: string,
    input: unknown,
  ): Promise<PaymentDto>;
  /** Deletes a phase (`realestate.write`, Pro). */
  removePayment(headers: Headers, poolId: string, id: string, paymentId: string): Promise<void>;
  /**
   * Marks a phase paid by a bank debit: the phase takes the movement's date and the movement is
   * categorised as works (`realestate.write`, Pro).
   */
  linkTransaction(
    headers: Headers,
    poolId: string,
    id: string,
    paymentId: string,
    input: unknown,
  ): Promise<PaymentDto>;
  /** Takes the link away; the phase goes back to planned (`realestate.write`, Pro). */
  unlinkTransaction(
    headers: Headers,
    poolId: string,
    id: string,
    paymentId: string,
  ): Promise<PaymentDto>;
}

export interface WorksServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Works projects are a Pro feature (ADR 0003). */
  entitlements: Entitlements;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
}

type Permission = 'pool.read' | 'realestate.write';

/** The category a bank debit gets when it pays a phase (a global one, see `global-categories`). */
const WORKS_CATEGORY_KEY = 'works';

/** Cross-field rules of a project (the check constraints repeat the single-column ones). */
function assertDates(values: WorksProjectValues): WorksProjectValues {
  if (values.startDate && values.plannedEnd && values.plannedEnd < values.startDate) {
    throw invalid('plannedEnd', 'cannot be before the start date');
  }
  return values;
}

export function createWorksService(deps: WorksServiceDeps): WorksService {
  const { auth, identity, entitlements } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

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

  /** The projects as DTOs from one load of phases. */
  async function view(tx: PoolTx, ctx: PoolContext, propertyId?: string, only?: string) {
    const rows = (await worksRepo.listProjects(tx, ctx, propertyId)).filter(
      (row) => !only || row.id === only,
    );
    const phases = await worksRepo.listPayments(
      tx,
      ctx,
      rows.map((row) => row.id),
    );
    return rows.map((row) =>
      toWorkDto(
        row,
        phases.filter((phase) => phase.projectId === row.id),
      ),
    );
  }

  async function one(tx: PoolTx, ctx: PoolContext, id: string): Promise<WorkDto> {
    const found = (await view(tx, ctx, undefined, id))[0];
    if (!found) throw new NotFoundError();
    return WorkDto.parse(found);
  }

  async function project(tx: PoolTx, ctx: PoolContext, id: string): Promise<WorksProjectRow> {
    const row = await worksRepo.findProject(tx, ctx, id);
    if (!row) throw new NotFoundError();
    return row;
  }

  async function payment(tx: PoolTx, ctx: PoolContext, projectId: string, id: string) {
    await project(tx, ctx, projectId);
    const row = await worksRepo.findPayment(tx, ctx, projectId, id);
    if (!row) throw new NotFoundError();
    return row;
  }

  return {
    async list(headers, poolId, propertyId) {
      const ctx = await guard(headers, poolId, 'pool.read');
      const filter = propertyId === undefined ? undefined : parseId(propertyId);
      return run(ctx, async (tx) => {
        const projects = await view(tx, ctx, filter);
        const properties = [...new Set(projects.map((item) => item.propertyId))];
        return WorkListDto.parse({
          projects,
          byProperty: properties.map((id) => ({
            propertyId: id,
            ...propertyWorkTotals(
              projects
                .filter((item) => item.propertyId === id)
                .map((item) => ({
                  budget: item.budget,
                  status: item.status,
                  phases: item.phases,
                })),
            ),
          })),
        });
      });
    },

    async get(headers, poolId, id) {
      const ctx = await guard(headers, poolId, 'pool.read');
      const projectId = parseId(id);
      return run(ctx, (tx) => one(tx, ctx, projectId));
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateWorkInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const data = parsed.data;
      const values = assertDates({
        propertyId: data.propertyId,
        name: data.name,
        description: data.description ?? null,
        supplier: data.supplier ?? null,
        budget: data.budget,
        depositPct: data.depositPct ?? null,
        status: data.status ?? 'planned',
        startDate: data.startDate ?? null,
        plannedEnd: data.plannedEnd ?? null,
        notes: data.notes ?? null,
      });
      const id = newId();
      const dto = await run(ctx, async (tx) => {
        if (!(await propertiesRepo.find(tx, ctx, values.propertyId))) {
          throw invalid('propertyId', 'not a property of this pool');
        }
        await worksRepo.insertProject(tx, ctx, id, values);
        return one(tx, ctx, id);
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'work.created', { target: id, ip: ipOf(headers) });
      return dto;
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateWorkInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const projectId = parseId(id);
      const patch = parsed.data;
      const dto = await run(ctx, async (tx) => {
        const current = await project(tx, ctx, projectId);
        const pick = <T>(next: T | undefined, now: T): T => (next === undefined ? now : next);
        const values = assertDates({
          propertyId: current.propertyId,
          name: pick(patch.name, current.name),
          description: pick(patch.description, current.description),
          supplier: pick(patch.supplier, current.supplier),
          budget: pick(patch.budget, current.budget),
          depositPct: pick(patch.depositPct, current.depositPct),
          status: pick(patch.status, current.status),
          startDate: pick(patch.startDate, current.startDate),
          plannedEnd: pick(patch.plannedEnd, current.plannedEnd),
          notes: pick(patch.notes, current.notes),
        });
        await worksRepo.updateProject(tx, ctx, projectId, values);
        return one(tx, ctx, projectId);
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'work.updated', { target: projectId, ip: ipOf(headers) });
      return dto;
    },

    async remove(headers, poolId, id) {
      const ctx = await guard(headers, poolId, 'realestate.write');
      const projectId = parseId(id);
      const removed = await run(ctx, (tx) => worksRepo.removeProject(tx, ctx, projectId));
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'work.deleted', { target: projectId, ip: ipOf(headers) });
    },

    async upcoming(headers, poolId) {
      const ctx = await guard(headers, poolId, 'pool.read');
      return run(ctx, async (tx) => {
        const projects = await worksRepo.listProjects(tx, ctx);
        const names = new Map(projects.map((row) => [row.id, row]));
        const phases = await worksRepo.listPayments(tx, ctx);
        const months = upcomingByMonth(
          phases.flatMap((phase) => {
            const owner = names.get(phase.projectId);
            if (!owner || !phase.plannedDate) return [];
            return [
              {
                amount: phase.amount,
                status: phase.status as 'planned' | 'paid',
                plannedDate: phase.plannedDate,
                phase: {
                  id: phase.id,
                  projectId: owner.id,
                  projectName: owner.name,
                  propertyId: owner.propertyId,
                  description: phase.description,
                  amount: phase.amount,
                  plannedDate: phase.plannedDate,
                },
              },
            ];
          }),
        );
        return UpcomingDto.parse({ months });
      });
    },

    async addPayment(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreatePaymentInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const projectId = parseId(id);
      const paymentId = newId();
      const values: WorksPaymentValues = {
        description: parsed.data.description,
        amount: parsed.data.amount,
        plannedDate: parsed.data.plannedDate ?? null,
        paidDate: null,
        status: 'planned',
      };
      const dto = await run(ctx, async (tx) => {
        await project(tx, ctx, projectId);
        return toPaymentDto(await worksRepo.insertPayment(tx, ctx, projectId, paymentId, values));
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'work.payment_added', {
        target: projectId,
        ip: ipOf(headers),
      });
      return PaymentDto.parse(dto);
    },

    async updatePayment(headers, poolId, id, paymentId, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdatePaymentInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const projectId = parseId(id);
      const rowId = parseId(paymentId);
      const patch = parsed.data;
      const dto = await run(ctx, async (tx) => {
        const current = await payment(tx, ctx, projectId, rowId);
        if (current.transactionId && patch.paidDate !== undefined) {
          throw invalid('paidDate', 'follows the linked movement; unlink it first');
        }
        const paidDate = patch.paidDate === undefined ? current.paidDate : patch.paidDate;
        const updated = await worksRepo.updatePayment(tx, ctx, projectId, rowId, {
          description: patch.description ?? current.description,
          amount: patch.amount ?? current.amount,
          plannedDate: patch.plannedDate === undefined ? current.plannedDate : patch.plannedDate,
          paidDate,
          status: paidDate ? 'paid' : 'planned',
        });
        if (!updated) throw new NotFoundError();
        return toPaymentDto(updated);
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'work.payment_updated', {
        target: projectId,
        ip: ipOf(headers),
      });
      return PaymentDto.parse(dto);
    },

    async removePayment(headers, poolId, id, paymentId) {
      const ctx = await guard(headers, poolId, 'realestate.write');
      const projectId = parseId(id);
      const rowId = parseId(paymentId);
      const removed = await run(ctx, (tx) => worksRepo.removePayment(tx, ctx, projectId, rowId));
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'work.payment_deleted', {
        target: projectId,
        ip: ipOf(headers),
      });
    },

    async linkTransaction(headers, poolId, id, paymentId, input) {
      const session = await requireSession(auth, headers);
      const parsed = LinkTransactionInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const projectId = parseId(id);
      const rowId = parseId(paymentId);
      const dto = await run(ctx, async (tx) => {
        const current = await payment(tx, ctx, projectId, rowId);
        if (current.transactionId) {
          throw new ConflictError('This phase is already linked to a movement.');
        }
        const movement = await transactionsRepo.find(tx, ctx, parsed.data.transactionId);
        if (!movement) throw invalid('transactionId', 'not a movement of this pool');
        if (!dec(movement.amount).isNegative() || movement.transfer) {
          throw invalid('transactionId', 'must be a debit that is not a transfer');
        }
        const linked = await worksRepo.linkTransaction(
          tx,
          ctx,
          projectId,
          rowId,
          movement.id,
          movement.date,
        );
        if (!linked) throw new NotFoundError();
        const category = (await categoriesRepo.list(tx, ctx)).find(
          (row) => row.poolId === null && row.systemKey === WORKS_CATEGORY_KEY,
        );
        if (category) {
          await transactionsRepo.update(tx, ctx, movement.id, {
            categoryId: category.id,
            manualCategory: true,
          });
        }
        return toPaymentDto(linked);
      }).catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ConflictError('That movement already pays another phase.');
        }
        return refOrRethrow(error);
      });
      await recordAudit(identity, ctx, 'work.payment_linked', {
        target: projectId,
        ip: ipOf(headers),
      });
      return PaymentDto.parse(dto);
    },

    async unlinkTransaction(headers, poolId, id, paymentId) {
      const ctx = await guard(headers, poolId, 'realestate.write');
      const projectId = parseId(id);
      const rowId = parseId(paymentId);
      const dto = await run(ctx, async (tx) => {
        const current = await payment(tx, ctx, projectId, rowId);
        if (!current.transactionId) throw invalid('transactionId', 'the phase has no link');
        const unlinked = await worksRepo.unlinkTransaction(tx, ctx, projectId, rowId);
        if (!unlinked) throw new NotFoundError();
        return toPaymentDto(unlinked);
      });
      await recordAudit(identity, ctx, 'work.payment_unlinked', {
        target: projectId,
        ip: ipOf(headers),
      });
      return PaymentDto.parse(dto);
    },
  };
}
