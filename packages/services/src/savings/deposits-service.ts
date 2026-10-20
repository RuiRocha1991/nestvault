import {
  accountsRepo,
  depositsRepo,
  newId,
  poolSettingsRepo,
  savingsProductsRepo,
  withPool,
  type DepositRow,
  type DepositValues,
  type IdentityDatabase,
  type PoolRunner,
} from '@nestvault/db';
import { depositSchedule, depositValue } from '@nestvault/domain';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { isForeignKeyViolation, isUniqueViolation } from '../db-errors';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { invalid, parseId } from '../investments/checks';
import { clientIpResolver } from '../rate-limit/client-ip';

import { assertFundingAccount, assertPeriods, lowerOrNull } from './checks';
import { toDomainDeposit } from './domain';
import {
  CreateDepositInput,
  DepositDto,
  DepositListDto,
  DepositScheduleDto,
  ScheduleQuery,
  toDepositDto,
  toScheduleDto,
  UpdateDepositInput,
} from './schemas';

export interface DepositsService {
  /** Deposits of the pool (any member). */
  list(headers: Headers, poolId: string): Promise<DepositListDto>;
  /** One deposit (any member). */
  get(headers: Headers, poolId: string, id: string): Promise<DepositDto>;
  /**
   * Creates the deposit of a term-deposit account (`accounts.write`), one per account (409). With a
   * product, the fields left out are filled from it; what is sent overrides it.
   */
  create(headers: Headers, poolId: string, input: unknown): Promise<DepositDto>;
  /** Changes a deposit; fields left out stay (`accounts.write`). */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<DepositDto>;
  /** Deletes the deposit; its account stays (`accounts.write`). */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
  /** Interest payments, next payment, maturity and value of a deposit (any member). */
  schedule(
    headers: Headers,
    poolId: string,
    id: string,
    query?: unknown,
  ): Promise<DepositScheduleDto>;
}

export interface DepositsServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  now?: () => Date;
}

const toValues = (row: DepositRow): DepositValues => ({
  productId: row.productId,
  capital: row.capital,
  start: row.start,
  rate: row.rate,
  payN: row.payN,
  payU: row.payU,
  termN: row.termN,
  termU: row.termU,
  capitalize: row.capitalize,
  tax: row.tax,
  payToAccountId: row.payToAccountId,
  fundFromAccountId: row.fundFromAccountId,
});

export function createDepositsService(deps: DepositsServiceDeps): DepositsService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);
  const now = deps.now ?? (() => new Date());

  /** A reference that slipped past the checks (a race) is still a client error, not a 500. */
  const refOrRethrow = (error: unknown): never => {
    if (isForeignKeyViolation(error)) throw invalid('reference', 'a reference is not valid');
    throw error;
  };

  return {
    async list(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const rows = await run(ctx, (tx) => depositsRepo.list(tx, ctx));
      return DepositListDto.parse({ deposits: rows.map(toDepositDto) });
    },

    async get(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const row = await run(ctx, (tx) => depositsRepo.find(tx, ctx, parseId(id)));
      if (!row) throw new NotFoundError();
      return DepositDto.parse(toDepositDto(row));
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateDepositInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const data = parsed.data;
      const accountId = data.accountId.toLowerCase();
      const productId = lowerOrNull(data.productId);
      const id = newId();
      const row = await run(ctx, async (tx) => {
        const account = await accountsRepo.find(tx, ctx, accountId);
        if (!account || account.type !== 'term_deposit') {
          throw invalid('accountId', 'not a term-deposit account of this pool');
        }
        if (await depositsRepo.findByAccount(tx, ctx, accountId)) {
          throw new ConflictError('This account already has a deposit.');
        }
        const product = productId ? await savingsProductsRepo.find(tx, ctx, productId) : undefined;
        if (productId && !product) throw invalid('productId', 'not a product of this pool');
        // What is sent wins (`null` means "none"); what is left out comes from the product.
        const rate = data.rate ?? product?.rate;
        if (rate === undefined) throw invalid('rate', 'needed when there is no product');
        const values: DepositValues = {
          productId,
          capital: data.capital,
          start: data.start,
          rate,
          payN: data.payN === undefined ? (product?.payN ?? null) : data.payN,
          payU: data.payU === undefined ? (product?.payU ?? null) : data.payU,
          termN: data.termN === undefined ? (product?.termN ?? null) : data.termN,
          termU: data.termU === undefined ? (product?.termU ?? null) : data.termU,
          capitalize: data.capitalize ?? false,
          tax: data.tax === undefined ? (product?.tax ?? null) : data.tax,
          payToAccountId:
            data.payToAccountId === undefined
              ? (product?.payToAccountId ?? null)
              : lowerOrNull(data.payToAccountId),
          fundFromAccountId:
            data.fundFromAccountId === undefined
              ? (product?.fundFromAccountId ?? null)
              : lowerOrNull(data.fundFromAccountId),
        };
        assertPeriods(values);
        await assertFundingAccount(tx, ctx, values.payToAccountId, 'payToAccountId');
        await assertFundingAccount(tx, ctx, values.fundFromAccountId, 'fundFromAccountId');
        return depositsRepo.insert(tx, ctx, id, accountId, values);
      }).catch((error: unknown) => {
        if (isUniqueViolation(error))
          throw new ConflictError('This account already has a deposit.');
        return refOrRethrow(error);
      });
      await recordAudit(identity, ctx, 'deposit.created', { target: id, ip: ipOf(headers) });
      return DepositDto.parse(toDepositDto(row));
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateDepositInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const depositId = parseId(id);
      const data = parsed.data;
      const row = await run(ctx, async (tx) => {
        const current = await depositsRepo.find(tx, ctx, depositId);
        if (!current) throw new NotFoundError();
        const base = toValues(current);
        const pick = <K extends keyof DepositValues>(
          key: K,
          value: DepositValues[K] | undefined,
        ) => (value === undefined ? base[key] : value);
        const values: DepositValues = {
          productId: pick('productId', lowerOrNull(data.productId)),
          capital: data.capital ?? base.capital,
          start: data.start ?? base.start,
          rate: data.rate ?? base.rate,
          payN: pick('payN', data.payN),
          payU: pick('payU', data.payU),
          termN: pick('termN', data.termN),
          termU: pick('termU', data.termU),
          capitalize: data.capitalize ?? base.capitalize,
          tax: pick('tax', data.tax),
          payToAccountId: pick('payToAccountId', lowerOrNull(data.payToAccountId)),
          fundFromAccountId: pick('fundFromAccountId', lowerOrNull(data.fundFromAccountId)),
        };
        assertPeriods(values);
        if (values.productId && !(await savingsProductsRepo.find(tx, ctx, values.productId))) {
          throw invalid('productId', 'not a product of this pool');
        }
        await assertFundingAccount(tx, ctx, values.payToAccountId, 'payToAccountId');
        await assertFundingAccount(tx, ctx, values.fundFromAccountId, 'fundFromAccountId');
        const updated = await depositsRepo.update(tx, ctx, depositId, values);
        if (!updated) throw new NotFoundError();
        return updated;
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'deposit.updated', { target: depositId, ip: ipOf(headers) });
      return DepositDto.parse(toDepositDto(row));
    },

    async remove(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const depositId = parseId(id);
      const removed = await run(ctx, (tx) => depositsRepo.remove(tx, ctx, depositId));
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'deposit.deleted', { target: depositId, ip: ipOf(headers) });
    },

    async schedule(headers, poolId, id, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = ScheduleQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const depositId = parseId(id);
      const asOf = parsed.data.asOf ?? now().toISOString().slice(0, 10);
      const found = await run(ctx, async (tx) => {
        const row = await depositsRepo.find(tx, ctx, depositId);
        if (!row) return undefined;
        const settings = await poolSettingsRepo.find(tx, ctx);
        return { row, defaultTax: settings?.depositTax ?? '28' };
      });
      if (!found) throw new NotFoundError();
      const deposit = toDomainDeposit(found.row);
      return DepositScheduleDto.parse(
        toScheduleDto(
          found.row.id,
          asOf,
          found.defaultTax,
          depositSchedule(deposit, asOf, found.defaultTax),
          depositValue(deposit, asOf, found.defaultTax),
        ),
      );
    },
  };
}
