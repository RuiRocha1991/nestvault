import {
  holdersRepo,
  newId,
  propertiesRepo,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
  type PropertyShare,
  type PropertyValues,
  type PropertyRow,
} from '@nestvault/db';
import { dec, sharesAddUpTo100, toPlain } from '@nestvault/domain';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { isForeignKeyViolation, isUniqueViolation } from '../db-errors';
import type { Entitlements } from '../entitlements';
import { ConflictError, NotFoundError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { invalid, parseId, refOrRethrow } from '../investments/checks';
import { clientIpResolver } from '../rate-limit/client-ip';
import { zodProblem } from '../zod-problem';

import {
  CreatePropertyInput,
  CreateValuationInput,
  PropertyDto,
  PropertyListDto,
  toPropertyDto,
  toValuationDto,
  UpdatePropertyInput,
  ValuationDto,
  ValuationListDto,
  type CostsInput,
  type HolderShareInput,
} from './schemas';

export interface PropertiesService {
  /** The pool's properties with owners and latest valuation (`pool.read`, Pro). */
  list(headers: Headers, poolId: string): Promise<PropertyListDto>;
  /** One property (`pool.read`, Pro). */
  get(headers: Headers, poolId: string, id: string): Promise<PropertyDto>;
  /** Registers a property with its owners (`realestate.write`, Pro). */
  create(headers: Headers, poolId: string, input: unknown): Promise<PropertyDto>;
  /** Changes a property; fields left out stay, `holders` replaces the owners (`realestate.write`, Pro). */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<PropertyDto>;
  /** Deletes a property with its owners and valuations (`realestate.write`, Pro). */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
  /** The valuations of a property, newest first (`pool.read`, Pro). */
  listValuations(headers: Headers, poolId: string, id: string): Promise<ValuationListDto>;
  /** Adds a valuation; one per day (`realestate.write`, Pro). */
  addValuation(headers: Headers, poolId: string, id: string, input: unknown): Promise<ValuationDto>;
  /** Deletes a valuation (`realestate.write`, Pro). */
  removeValuation(headers: Headers, poolId: string, id: string, valuationId: string): Promise<void>;
}

export interface PropertiesServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Real estate is a Pro feature (ADR 0003). */
  entitlements: Entitlements;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
}

const ZERO = '0';

/** Owners as stored: lower case ids, shares as plain decimals, each person once, adding up to 100. */
function toShares(holders: readonly HolderShareInput[]): PropertyShare[] {
  const shares = new Map<string, PropertyShare>();
  for (const holder of holders) {
    const holderId = holder.holderId.toLowerCase();
    if (shares.has(holderId)) throw invalid('holders', 'a person can appear only once');
    shares.set(holderId, { holderId, sharePct: toPlain(dec(holder.sharePct)) });
  }
  const list = [...shares.values()];
  if (!sharesAddUpTo100(list.map((share) => share.sharePct))) {
    throw invalid('holders', 'the shares must add up to 100%');
  }
  return list;
}

/** The owners must be people of this pool (the composite foreign key repeats the rule). */
async function assertHolders(tx: PoolTx, ctx: PoolContext, shares: readonly PropertyShare[]) {
  for (const share of shares) {
    if (!(await holdersRepo.find(tx, ctx, share.holderId))) {
      throw invalid('holders', 'not a person of this pool');
    }
  }
}

/** Cross-field rule: the down payment cannot be more than the price (the check constraint repeats it). */
function assertValues(values: PropertyValues): PropertyValues {
  if (dec(values.downPayment).gt(values.purchasePrice)) {
    throw invalid('downPayment', 'cannot be more than the price');
  }
  return values;
}

const costsOf = (row: PropertyRow, patch: CostsInput | undefined) => ({
  deedCost: patch?.deed ?? row.deedCost,
  imt: patch?.imt ?? row.imt,
  stampDuty: patch?.stampDuty ?? row.stampDuty,
  registrationCost: patch?.registration ?? row.registrationCost,
  bankFees: patch?.bankFees ?? row.bankFees,
});

export function createPropertiesService(deps: PropertiesServiceDeps): PropertiesService {
  const { auth, identity, entitlements } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

  /** The properties as DTOs, from one load of owners and valuations. */
  async function view(tx: PoolTx, ctx: PoolContext, ids?: readonly string[]) {
    const [rows, holders, valuations] = await Promise.all([
      propertiesRepo.list(tx, ctx),
      propertiesRepo.listHolders(tx, ctx),
      propertiesRepo.listValuations(tx, ctx),
    ]);
    return rows
      .filter((row) => !ids || ids.includes(row.id))
      .map((row) =>
        toPropertyDto(
          row,
          holders.filter((holder) => holder.propertyId === row.id),
          valuations.filter((valuation) => valuation.propertyId === row.id),
        ),
      );
  }

  async function one(tx: PoolTx, ctx: PoolContext, id: string): Promise<PropertyDto> {
    const found = (await view(tx, ctx, [id]))[0];
    if (!found) throw new NotFoundError();
    return PropertyDto.parse(found);
  }

  /** Guards 1, 3, 4 and the plan: session, membership (404), permission (403), then Pro (403 `plan_limit`). */
  async function guard(
    headers: Headers,
    poolId: string,
    permission: 'pool.read' | 'realestate.write',
  ) {
    const session = await requireSession(auth, headers);
    return { session, ctx: await membership(session, poolId, permission) };
  }

  async function membership(
    session: Awaited<ReturnType<typeof requireSession>>,
    poolId: string,
    permission: 'pool.read' | 'realestate.write',
  ) {
    const ctx = await requirePoolAccess(identity, session, poolId);
    can(ctx, permission);
    await entitlements.assertFeature(ctx, 'real_estate');
    return ctx;
  }

  return {
    async list(headers, poolId) {
      const { ctx } = await guard(headers, poolId, 'pool.read');
      return PropertyListDto.parse({ properties: await run(ctx, (tx) => view(tx, ctx)) });
    },

    async get(headers, poolId, id) {
      const { ctx } = await guard(headers, poolId, 'pool.read');
      const propertyId = parseId(id);
      return run(ctx, (tx) => one(tx, ctx, propertyId));
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreatePropertyInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const data = parsed.data;
      const shares = toShares(data.holders);
      const values = assertValues({
        name: data.name,
        type: data.type,
        address: data.address ?? null,
        purchaseDate: data.purchaseDate,
        purchasePrice: data.purchasePrice,
        downPayment: data.downPayment ?? ZERO,
        deedCost: data.costs?.deed ?? ZERO,
        imt: data.costs?.imt ?? ZERO,
        stampDuty: data.costs?.stampDuty ?? ZERO,
        registrationCost: data.costs?.registration ?? ZERO,
        bankFees: data.costs?.bankFees ?? ZERO,
        sellingCostPct: data.sellingCostPct ?? null,
        includeInNetWorth: data.includeInNetWorth ?? true,
      });
      const id = newId();
      const dto = await run(ctx, async (tx) => {
        await assertHolders(tx, ctx, shares);
        await propertiesRepo.insert(tx, ctx, id, values);
        await propertiesRepo.replaceHolders(tx, ctx, id, shares);
        return one(tx, ctx, id);
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'property.created', { target: id, ip: ipOf(headers) });
      return dto;
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdatePropertyInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const propertyId = parseId(id);
      const patch = parsed.data;
      const shares = patch.holders ? toShares(patch.holders) : undefined;
      const dto = await run(ctx, async (tx) => {
        const current = await propertiesRepo.find(tx, ctx, propertyId);
        if (!current) throw new NotFoundError();
        const values = assertValues({
          name: patch.name ?? current.name,
          type: patch.type ?? current.type,
          address: patch.address === undefined ? current.address : patch.address,
          purchaseDate: patch.purchaseDate ?? current.purchaseDate,
          purchasePrice: patch.purchasePrice ?? current.purchasePrice,
          downPayment: patch.downPayment ?? current.downPayment,
          ...costsOf(current, patch.costs),
          sellingCostPct:
            patch.sellingCostPct === undefined ? current.sellingCostPct : patch.sellingCostPct,
          includeInNetWorth: patch.includeInNetWorth ?? current.includeInNetWorth,
        });
        await propertiesRepo.update(tx, ctx, propertyId, values);
        if (shares) {
          await assertHolders(tx, ctx, shares);
          await propertiesRepo.replaceHolders(tx, ctx, propertyId, shares);
        }
        return one(tx, ctx, propertyId);
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'property.updated', {
        target: propertyId,
        ip: ipOf(headers),
      });
      return dto;
    },

    async remove(headers, poolId, id) {
      const { ctx } = await guard(headers, poolId, 'realestate.write');
      const propertyId = parseId(id);
      const removed = await run(ctx, (tx) => propertiesRepo.remove(tx, ctx, propertyId)).catch(
        (error: unknown) => {
          // A loan still points at the property (restrict): delete or move the loan first.
          if (isForeignKeyViolation(error)) {
            throw new ConflictError('This property still has loans or works. Delete or move them first.');
          }
          throw error;
        },
      );
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'property.deleted', {
        target: propertyId,
        ip: ipOf(headers),
      });
    },

    async listValuations(headers, poolId, id) {
      const { ctx } = await guard(headers, poolId, 'pool.read');
      const propertyId = parseId(id);
      return run(ctx, async (tx) => {
        if (!(await propertiesRepo.find(tx, ctx, propertyId))) throw new NotFoundError();
        const rows = await propertiesRepo.listValuations(tx, ctx, [propertyId]);
        return ValuationListDto.parse({ valuations: rows.map(toValuationDto) });
      });
    },

    async addValuation(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateValuationInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await membership(session, poolId, 'realestate.write');
      const propertyId = parseId(id);
      const row = await run(ctx, async (tx) => {
        if (!(await propertiesRepo.find(tx, ctx, propertyId))) throw new NotFoundError();
        return propertiesRepo.insertValuation(tx, ctx, propertyId, {
          date: parsed.data.date,
          value: parsed.data.value,
          source: parsed.data.source ?? 'manual',
        });
      }).catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ConflictError('This property already has a valuation for that day.');
        }
        throw error;
      });
      await recordAudit(identity, ctx, 'property.valuation_added', {
        target: propertyId,
        ip: ipOf(headers),
      });
      return ValuationDto.parse(toValuationDto(row));
    },

    async removeValuation(headers, poolId, id, valuationId) {
      const { ctx } = await guard(headers, poolId, 'realestate.write');
      const propertyId = parseId(id);
      const idOfValuation = parseId(valuationId);
      const removed = await run(ctx, (tx) =>
        propertiesRepo.removeValuation(tx, ctx, propertyId, idOfValuation),
      );
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'property.valuation_deleted', {
        target: propertyId,
        ip: ipOf(headers),
      });
    },
  };
}
