import {
  categoriesRepo,
  categorySettingsRepo,
  isUuid,
  newId,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
} from '@nestvault/db';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { isUniqueViolation } from '../db-errors';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { clientIpResolver } from '../rate-limit/client-ip';

import {
  CategoryDto,
  CategoryListDto,
  CreateCategoryInput,
  DEFAULT_CATEGORY_COLOR,
  DeleteCategoryQuery,
  toCategoryDto,
  UpdateCategoryInput,
  UpdateCategorySettingsInput,
} from './schemas';

export interface CategoriesService {
  /** The global catalogue plus the pool's own categories, with the pool's settings merged (any member). */
  list(headers: Headers, poolId: string): Promise<CategoryListDto>;
  /** Creates a category of this pool (`categories.write`); the name is unique in the pool (409). */
  create(headers: Headers, poolId: string, input: unknown): Promise<CategoryDto>;
  /** Changes one of the pool's own categories (`categories.write`); a global one answers 403. */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<CategoryDto>;
  /**
   * Deletes one of the pool's own categories (`categories.write`); a global one answers 403. Its
   * transactions move to `replacement`, which is required while any use it.
   */
  remove(headers: Headers, poolId: string, id: string, query?: unknown): Promise<void>;
  /** Budget, own colour and hidden flag of any category the pool sees (`categories.write`). */
  updateSettings(
    headers: Headers,
    poolId: string,
    id: string,
    input: unknown,
  ): Promise<CategoryDto>;
}

export interface CategoriesServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
}

export function createCategoriesService(deps: CategoriesServiceDeps): CategoriesService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

  const parseId = (id: string) => {
    if (!isUuid(id)) throw new NotFoundError();
    return id.toLowerCase();
  };

  async function read(tx: PoolTx, ctx: PoolContext, only?: string): Promise<CategoryDto[]> {
    const [rows, settings] = await Promise.all([
      categoriesRepo.list(tx, ctx),
      categorySettingsRepo.list(tx, ctx),
    ]);
    const byCategory = new Map(settings.map((row) => [row.categoryId, row]));
    return rows
      .filter((row) => !only || row.id === only)
      .map((row) => toCategoryDto(row, byCategory.get(row.id)));
  }

  const nameTaken = (error: unknown): never => {
    if (isUniqueViolation(error)) throw new ConflictError('A category with this name exists.');
    throw error;
  };

  return {
    async list(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      return CategoryListDto.parse({ categories: await run(ctx, (tx) => read(tx, ctx)) });
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateCategoryInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'categories.write');
      const id = newId();
      try {
        await run(ctx, (tx) =>
          categoriesRepo.insert(tx, ctx, id, {
            name: parsed.data.name,
            kind: parsed.data.kind,
            color: parsed.data.color ?? DEFAULT_CATEGORY_COLOR,
          }),
        );
      } catch (error) {
        nameTaken(error);
      }
      await recordAudit(identity, ctx, 'category.created', { target: id, ip: ipOf(headers) });
      const [created] = await run(ctx, (tx) => read(tx, ctx, id));
      if (!created) throw new NotFoundError();
      return CategoryDto.parse(created);
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateCategoryInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'categories.write');
      const categoryId = parseId(id);
      try {
        await run(ctx, async (tx) => {
          const current = await categoriesRepo.find(tx, ctx, categoryId);
          if (!current) throw new NotFoundError();
          // The catalogue belongs to the app, not to a pool: only the pool's budget, colour and
          // visibility of it can change, through the settings.
          if (current.poolId === null)
            throw new ForbiddenError('A global category cannot be changed.');
          await categoriesRepo.update(tx, ctx, categoryId, {
            name: parsed.data.name ?? current.name ?? '',
            kind: parsed.data.kind ?? current.kind,
            color: parsed.data.color ?? current.color,
          });
        });
      } catch (error) {
        nameTaken(error);
      }
      await recordAudit(identity, ctx, 'category.updated', {
        target: categoryId,
        ip: ipOf(headers),
      });
      const [updated] = await run(ctx, (tx) => read(tx, ctx, categoryId));
      if (!updated) throw new NotFoundError();
      return CategoryDto.parse(updated);
    },

    async remove(headers, poolId, id, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = DeleteCategoryQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'categories.write');
      const categoryId = parseId(id);
      const replacement = parsed.data.replacement?.toLowerCase();
      await run(ctx, async (tx) => {
        const current = await categoriesRepo.find(tx, ctx, categoryId);
        if (!current) throw new NotFoundError();
        if (current.poolId === null)
          throw new ForbiddenError('A global category cannot be deleted.');
        const uses = await categoriesRepo.countReferences(tx, ctx, categoryId);
        if (replacement) {
          if (replacement === categoryId) {
            throw new ValidationError('The request is not valid.', [
              { path: 'replacement', message: 'must be another category' },
            ]);
          }
          if (!(await categoriesRepo.find(tx, ctx, replacement))) {
            throw new ValidationError('The request is not valid.', [
              { path: 'replacement', message: 'not a category of this pool' },
            ]);
          }
          await categoriesRepo.reassign(tx, ctx, categoryId, replacement);
        } else if (uses > 0) {
          throw new ValidationError('The request is not valid.', [
            { path: 'replacement', message: 'required while transactions use the category' },
          ]);
        }
        await categoriesRepo.remove(tx, ctx, categoryId);
      });
      await recordAudit(identity, ctx, 'category.deleted', {
        target: categoryId,
        ip: ipOf(headers),
      });
    },

    async updateSettings(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateCategorySettingsInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'categories.write');
      const categoryId = parseId(id);
      await run(ctx, async (tx) => {
        // Read through RLS: a category of another pool is not found, so it cannot be pointed at.
        if (!(await categoriesRepo.find(tx, ctx, categoryId))) throw new NotFoundError();
        const current = await categorySettingsRepo.find(tx, ctx, categoryId);
        await categorySettingsRepo.upsert(tx, ctx, categoryId, {
          monthlyBudget:
            parsed.data.monthlyBudget === undefined
              ? (current?.monthlyBudget ?? null)
              : parsed.data.monthlyBudget,
          colorOverride:
            parsed.data.colorOverride === undefined
              ? (current?.colorOverride ?? null)
              : parsed.data.colorOverride,
          hidden: parsed.data.hidden ?? current?.hidden ?? false,
        });
      });
      await recordAudit(identity, ctx, 'category.settings_updated', {
        target: categoryId,
        meta: { count: Object.keys(parsed.data).length },
        ip: ipOf(headers),
      });
      const [updated] = await run(ctx, (tx) => read(tx, ctx, categoryId));
      if (!updated) throw new NotFoundError();
      return CategoryDto.parse(updated);
    },
  };
}
