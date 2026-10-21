import {
  depositsRepo,
  newId,
  savingsProductsRepo,
  withPool,
  type DepositRow,
  type IdentityDatabase,
  type PoolRunner,
  type SavingsProductRow,
  type SavingsProductValues,
} from '@nestvault/db';
import { dec, roundTo, sum, toPlain } from '@nestvault/domain';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { isForeignKeyViolation, isUniqueViolation } from '../db-errors';
import { ConflictError, NotFoundError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { parseId } from '../investments/checks';
import { clientIpResolver } from '../rate-limit/client-ip';
import { zodProblem } from '../zod-problem';

import { assertFundingAccount, assertPeriods, lowerOrNull } from './checks';
import {
  CreateProductInput,
  ProductDto,
  ProductListDto,
  toProductDto,
  UpdateProductInput,
} from './schemas';

export interface ProductsService {
  /** Products of the pool with their deposits' total capital and weighted rate (any member). */
  list(headers: Headers, poolId: string): Promise<ProductListDto>;
  /** One product (any member). */
  get(headers: Headers, poolId: string, id: string): Promise<ProductDto>;
  /** Creates a product (`accounts.write`); the name is unique inside the pool (409). */
  create(headers: Headers, poolId: string, input: unknown): Promise<ProductDto>;
  /** Changes a product; fields left out stay. Deposits already made keep their own terms. */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<ProductDto>;
  /** Deletes a product; 409 while a deposit was made with it (`accounts.write`). */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
}

export interface ProductsServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
}

const toValues = (row: SavingsProductRow): SavingsProductValues => ({
  name: row.name,
  institution: row.institution,
  rate: row.rate,
  payN: row.payN,
  payU: row.payU,
  termN: row.termN,
  termU: row.termU,
  tax: row.tax,
  payToAccountId: row.payToAccountId,
  fundFromAccountId: row.fundFromAccountId,
});

/** The deposits made with one product: how many, the capital and the rate weighted by capital. */
function groupOf(deposits: readonly DepositRow[]) {
  const capital = sum(deposits.map((row) => dec(row.capital)));
  const weighted = sum(deposits.map((row) => dec(row.capital).times(row.rate)));
  return {
    depositsCount: deposits.length,
    capital: toPlain(capital),
    averageRate: capital.gt(0) ? toPlain(roundTo(weighted.div(capital), 4)) : null,
  };
}

export function createProductsService(deps: ProductsServiceDeps): ProductsService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

  const uniqueName = (error: unknown): never => {
    if (isUniqueViolation(error)) throw new ConflictError('A product with this name exists.');
    throw error;
  };

  return {
    async list(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const [rows, deposits] = await run(ctx, (tx) =>
        Promise.all([savingsProductsRepo.list(tx, ctx), depositsRepo.list(tx, ctx)]),
      );
      return ProductListDto.parse({
        products: rows.map((row) =>
          toProductDto(row, groupOf(deposits.filter((deposit) => deposit.productId === row.id))),
        ),
      });
    },

    async get(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const productId = parseId(id);
      const found = await run(ctx, async (tx) => {
        const row = await savingsProductsRepo.find(tx, ctx, productId);
        if (!row) return undefined;
        const deposits = (await depositsRepo.list(tx, ctx)).filter((d) => d.productId === row.id);
        return toProductDto(row, groupOf(deposits));
      });
      if (!found) throw new NotFoundError();
      return ProductDto.parse(found);
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateProductInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const data = parsed.data;
      const values: SavingsProductValues = {
        name: data.name,
        institution: data.institution ?? null,
        rate: data.rate,
        payN: data.payN ?? null,
        payU: data.payU ?? null,
        termN: data.termN ?? null,
        termU: data.termU ?? null,
        tax: data.tax ?? null,
        payToAccountId: lowerOrNull(data.payToAccountId),
        fundFromAccountId: lowerOrNull(data.fundFromAccountId),
      };
      const id = newId();
      const row = await run(ctx, async (tx) => {
        await assertFundingAccount(tx, ctx, values.payToAccountId, 'payToAccountId');
        await assertFundingAccount(tx, ctx, values.fundFromAccountId, 'fundFromAccountId');
        return savingsProductsRepo.insert(tx, ctx, id, values);
      }).catch(uniqueName);
      await recordAudit(identity, ctx, 'product.created', { target: id, ip: ipOf(headers) });
      return ProductDto.parse(toProductDto(row, groupOf([])));
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateProductInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const productId = parseId(id);
      const data = parsed.data;
      const dto = await run(ctx, async (tx) => {
        const current = await savingsProductsRepo.find(tx, ctx, productId);
        if (!current) throw new NotFoundError();
        const base = toValues(current);
        const pick = <K extends keyof SavingsProductValues>(
          key: K,
          value: SavingsProductValues[K] | undefined,
        ) => (value === undefined ? base[key] : value);
        const values: SavingsProductValues = {
          name: data.name ?? base.name,
          institution: pick('institution', data.institution),
          rate: data.rate ?? base.rate,
          payN: pick('payN', data.payN),
          payU: pick('payU', data.payU),
          termN: pick('termN', data.termN),
          termU: pick('termU', data.termU),
          tax: pick('tax', data.tax),
          payToAccountId: pick('payToAccountId', lowerOrNull(data.payToAccountId)),
          fundFromAccountId: pick('fundFromAccountId', lowerOrNull(data.fundFromAccountId)),
        };
        assertPeriods(values);
        await assertFundingAccount(tx, ctx, values.payToAccountId, 'payToAccountId');
        await assertFundingAccount(tx, ctx, values.fundFromAccountId, 'fundFromAccountId');
        const row = await savingsProductsRepo.update(tx, ctx, productId, values);
        if (!row) throw new NotFoundError();
        const deposits = (await depositsRepo.list(tx, ctx)).filter((d) => d.productId === row.id);
        return toProductDto(row, groupOf(deposits));
      }).catch(uniqueName);
      await recordAudit(identity, ctx, 'product.updated', { target: productId, ip: ipOf(headers) });
      return ProductDto.parse(dto);
    },

    async remove(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const productId = parseId(id);
      await run(ctx, async (tx) => {
        if (!(await savingsProductsRepo.find(tx, ctx, productId))) throw new NotFoundError();
        if ((await depositsRepo.countByProduct(tx, ctx, productId)) > 0) {
          throw new ConflictError('This product has deposits. Remove or change them first.');
        }
        await savingsProductsRepo.remove(tx, ctx, productId);
      }).catch((error: unknown) => {
        // A deposit made between the count and the delete: the restrict foreign key says no.
        if (isForeignKeyViolation(error)) {
          throw new ConflictError('This product has deposits. Remove or change them first.');
        }
        throw error;
      });
      await recordAudit(identity, ctx, 'product.deleted', { target: productId, ip: ipOf(headers) });
    },
  };
}
