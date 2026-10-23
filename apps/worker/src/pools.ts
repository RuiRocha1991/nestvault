import type { PoolContext } from '@nestvault/db';
import { systemContext, type Logger, type Permission } from '@nestvault/services';

/**
 * Runs `work` once per pool, each with its own system context that holds only `permissions`.
 * The caller supplies the pool ids; a context cannot be turned into another pool's.
 *
 * One failing pool does not stop the others. When any failed the call throws at the end, so the
 * job is retried: jobs are idempotent, so the pools that succeeded are not harmed by running again.
 */
export async function forEachPool(
  poolIds: readonly string[],
  permissions: readonly Permission[],
  log: Logger,
  work: (ctx: PoolContext) => Promise<void>,
): Promise<void> {
  let failed = 0;
  for (const poolId of poolIds) {
    const poolLog = log.child({ pool_id: poolId });
    const started = performance.now();
    try {
      await work(systemContext(poolId, permissions));
      poolLog.info({ duration_ms: Math.round(performance.now() - started) }, 'pool done');
    } catch (error) {
      failed += 1;
      poolLog.error(
        { err: error, duration_ms: Math.round(performance.now() - started) },
        'pool failed',
      );
    }
  }
  if (failed > 0) throw new Error(`${String(failed)} of ${String(poolIds.length)} pools failed`);
}
