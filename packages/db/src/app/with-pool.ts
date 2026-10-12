import { sql } from 'drizzle-orm';

import type { PoolContext } from '../pool-context';

import { createAppDatabase, type AppDatabase, type PoolTx } from './client';

/**
 * Scopes the transaction to one pool: the value is read by the RLS policies through
 * `app_current_pool_id()`. It is bound as a parameter, never concatenated, and `true` makes it
 * local to the transaction, so it cannot leak to the next user of the pooled connection.
 *
 * @internal Exported for tests; production code calls `withPool`.
 */
export async function applyPoolSetting(tx: PoolTx, poolId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.pool_id', ${poolId}, true)`);
}

export type PoolRunner = <T>(ctx: PoolContext, run: (tx: PoolTx) => Promise<T>) => Promise<T>;

/** Builds a `withPool` bound to a specific database (tests pass their own). */
export function createWithPool(getDatabase: () => AppDatabase | Promise<AppDatabase>): PoolRunner {
  return async (ctx, run) => {
    const { db } = await getDatabase();
    return db.transaction(async (tx) => {
      await applyPoolSetting(tx, ctx.poolId);
      return run(tx);
    });
  };
}

/**
 * Runs `init` once and caches the result. A failed start (invalid env, missing module) is not
 * cached: the next call tries again.
 *
 * @internal Exported for tests.
 */
export function lazyOnce<T>(init: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => {
    cached ??= init().catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
    return cached;
  };
}

/** The shared connection pool, created on first use from the validated environment. */
const sharedAppDatabase = lazyOnce(async () => {
  const { runtimeEnv } = await import('@nestvault/config/node');
  return createAppDatabase(runtimeEnv().DATABASE_URL_APP);
});

/**
 * Runs `run` in a transaction scoped to `ctx.poolId`, so RLS applies. Every query on
 * `nestvault_app` goes through here (architecture rule 3).
 */
export const withPool: PoolRunner = createWithPool(sharedAppDatabase);
