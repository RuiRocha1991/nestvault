import {
  accountsRepo,
  assetPricesRepo,
  assetsRepo,
  categoriesRepo,
  categoryRulesRepo,
  categorySettingsRepo,
  depositsRepo,
  holdersRepo,
  interestEntriesRepo,
  investmentOpsRepo,
  newId,
  plansRepo,
  poolDataRepo,
  poolSettingsRepo,
  portfolioCashMovesRepo,
  portfoliosRepo,
  savingsProductsRepo,
  subAccountsRepo,
  transactionsRepo,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
} from '@nestvault/db';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { ConflictError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { ensureMemberHolders } from '../holders/sync-members';
import { logger } from '../logger';
import { clientIpResolver, type RateLimiter } from '../rate-limit';
import { DEFAULT_SETTINGS } from '../settings/schemas';

import { ImportResultDto } from './dto';
import { buildImportPlan, type ImportPlan } from './map';
import { IMPORT_MAX_DEPTH, ImportPrototypeInput, jsonDepth } from './schema';

export interface PrototypeImportService {
  /**
   * Imports a prototype export into an empty pool, all or nothing (`pool.import`: owner only).
   * `dryRun: true` returns the counts and warnings without writing; `false` commits them.
   */
  run(headers: Headers, poolId: string, input: unknown): Promise<ImportResultDto>;
}

export interface PrototypeImportServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  limiter: RateLimiter;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  now?: () => Date;
  /**
   * The plan's limits (ADR 0003: `assertWithinLimit(ctx, 'accounts' | 'portfolios')`), asked before
   * anything is written so a Free pool is refused up front with the dry run's counts, never half
   * imported. The entitlements module does not exist yet; it plugs in here when it does.
   */
  assertPlanLimits?: (
    ctx: PoolContext,
    wanted: { accounts: number; portfolios: number },
  ) => Promise<void>;
}

const CHUNK = 2000;

/** Total rows a commit writes (the audit entry carries this one number, never the data). */
const rowsOf = (plan: ImportPlan): number =>
  plan.newHolders.length +
  plan.portfolios.length +
  plan.accounts.length +
  plan.products.length +
  plan.deposits.length +
  plan.assets.length +
  plan.categories.length +
  plan.rules.length +
  plan.transactions.length +
  plan.plans.length +
  plan.ops.length +
  plan.cashMoves.length +
  plan.interest.length;

/** A Postgres data or constraint error (class 22 or 23): the file holds something the schema refuses. */
function isDataError(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : '';
  return typeof code === 'string' && (code.startsWith('22') || code.startsWith('23'));
}

export function createPrototypeImportService(
  deps: PrototypeImportServiceDeps,
): PrototypeImportService {
  const { auth, identity, limiter } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);
  const now = deps.now ?? (() => new Date());
  const assertPlanLimits = deps.assertPlanLimits ?? (() => Promise.resolve());

  /** Writes the plan in dependency order. Any failure aborts the surrounding transaction. */
  async function write(tx: PoolTx, ctx: PoolContext, plan: ImportPlan): Promise<void> {
    for (const holder of plan.newHolders) {
      await holdersRepo.insert(tx, ctx, holder.id, {
        name: holder.name,
        color: holder.color,
        aliases: holder.aliases,
        userId: null,
      });
    }
    for (const portfolio of plan.portfolios) {
      await portfoliosRepo.insert(tx, ctx, portfolio.id, portfolio.values);
    }
    for (const account of plan.accounts) {
      await accountsRepo.insert(tx, ctx, account.id, account.values);
      await accountsRepo.setHolders(tx, ctx, account.id, account.holderIds);
      for (const sub of account.subAccounts) {
        await subAccountsRepo.insert(tx, ctx, account.id, sub.id, {
          name: sub.name,
          holderId: sub.holderId,
        });
      }
    }
    for (const product of plan.products) {
      await savingsProductsRepo.insert(tx, ctx, product.id, product.values);
    }
    for (const deposit of plan.deposits) {
      await depositsRepo.insert(tx, ctx, deposit.id, deposit.accountId, deposit.values);
    }
    for (const asset of plan.assets) await assetsRepo.insert(tx, ctx, asset.id, asset.values);
    for (const [prices, source] of [
      [plan.historyPrices, 'bulk'],
      [plan.currentPrices, 'manual'],
    ] as const) {
      for (let at = 0; at < prices.length; at += CHUNK) {
        await assetPricesRepo.upsertMany(tx, ctx, prices.slice(at, at + CHUNK), source);
      }
    }
    for (const category of plan.categories) {
      await categoriesRepo.insert(tx, ctx, category.id, category.values);
    }
    for (const setting of plan.categorySettings) {
      await categorySettingsRepo.upsert(tx, ctx, setting.categoryId, setting.values);
    }
    await categoryRulesRepo.insertMany(tx, ctx, plan.rules);
    await transactionsRepo.insertMany(tx, ctx, plan.transactions);
    await transactionsRepo.setPairs(tx, ctx, plan.pairs);
    for (const item of plan.plans) await plansRepo.insert(tx, ctx, item.id, item.values);
    await investmentOpsRepo.insertMany(tx, ctx, plan.ops);
    for (const move of plan.cashMoves) {
      await portfolioCashMovesRepo.insert(tx, ctx, move.id, move.values);
    }
    for (const entry of plan.interest) {
      await interestEntriesRepo.insert(tx, ctx, entry.id, entry.values);
    }
    if (plan.settings) {
      const current = await poolSettingsRepo.find(tx, ctx);
      await poolSettingsRepo.upsert(
        tx,
        ctx,
        newId(),
        {
          transferWindowDays:
            plan.settings.transferWindowDays ??
            current?.transferWindowDays ??
            DEFAULT_SETTINGS.transferWindowDays,
          depositTax:
            plan.settings.depositTax ?? current?.depositTax ?? DEFAULT_SETTINGS.depositTax,
          dividendTax:
            plan.settings.dividendTax ?? current?.dividendTax ?? DEFAULT_SETTINGS.dividendTax,
          displayCurrency: current?.displayCurrency ?? DEFAULT_SETTINGS.displayCurrency,
          // The prototype's rates replace the pool's own overrides: they are the figures the owner
          // saw there. They can be cleared in the parameters afterwards.
          fxOverrides: plan.settings.fxOverrides,
        },
        ctx.actor.kind === 'user' ? ctx.actor.userId : null,
      );
    }
  }

  return {
    async run(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      if (jsonDepth(input) > IMPORT_MAX_DEPTH) {
        throw new ValidationError('The file is nested too deeply.');
      }
      const parsed = ImportPrototypeInput.safeParse(input);
      if (!parsed.success) {
        throw new ValidationError(
          'The file is not a prototype export.',
          parsed.error.issues.slice(0, 20).map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        );
      }
      const { dryRun, export: data } = parsed.data;
      if (data.demo) {
        throw new ValidationError('The file holds the prototype’s example data, not a backup.', [
          { path: 'export.demo', message: 'example data is not imported' },
        ]);
      }
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.import');
      await limiter.consume('imports', ctx.poolId);

      // The people who joined by an account exist as holders before the file's people are matched.
      await ensureMemberHolders({ identity, run, now }, ctx);

      let plan: ImportPlan;
      try {
        plan = await run(ctx, async (tx) => {
          // Serialize imports into this pool: a second one waits, then finds the pool not empty.
          await poolDataRepo.lockForImport(tx, ctx);
          const existing = await poolDataRepo.counts(tx, ctx);
          if (Object.values(existing).some((count) => count > 0)) {
            throw new ConflictError(
              'The pool already has data. A prototype export can only be imported into an empty pool.',
            );
          }
          const [holders, categories] = await Promise.all([
            holdersRepo.list(tx, ctx),
            categoriesRepo.list(tx, ctx),
          ]);
          const built = buildImportPlan({
            data,
            existingHolders: holders.map((holder) => ({ id: holder.id, name: holder.name })),
            globalCategories: categories.flatMap((category) =>
              category.poolId === null && category.systemKey !== null
                ? [
                    {
                      id: category.id,
                      systemKey: category.systemKey,
                      kind: category.kind,
                      color: category.color,
                    },
                  ]
                : [],
            ),
            newId,
          });
          await assertPlanLimits(ctx, {
            accounts: built.accounts.length,
            portfolios: built.portfolios.length,
          });
          if (!dryRun) await write(tx, ctx, built);
          return built;
        });
      } catch (error) {
        if (isDataError(error)) {
          // The schema refused a value the mapping let through: nothing was written. Which
          // constraint is logged; the data never is.
          const cause = (error as Error).cause as { constraint?: unknown } | undefined;
          logger.warn(
            { constraint: typeof cause?.constraint === 'string' ? cause.constraint : undefined },
            'prototype import refused by the database',
          );
          throw new ValidationError('The file has data the application cannot store.');
        }
        throw error;
      }

      if (!dryRun) {
        await recordAudit(identity, ctx, 'pool.prototype_imported', {
          target: ctx.poolId,
          meta: { count: rowsOf(plan) },
          ip: ipOf(headers),
        });
      }
      return ImportResultDto.parse({ dryRun, counts: plan.counts, warnings: plan.warnings });
    },
  };
}
