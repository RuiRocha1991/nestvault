import { poolsRepo } from '@nestvault/db';
import {
  CleanupError,
  cleanIdentity,
  cleanImportPreviews,
  IdentityCleanupError,
  removeStoredFile,
} from '@nestvault/services';
import { z } from 'zod';

import { forEachPool } from '../pools';

import { defineJob } from './define';
import type { TenantJobDeps } from './tenant';

/** A stored file written this recently is kept: it may belong to an upload that is being recorded. */
const FILE_MIN_AGE_MS = 60 * 60 * 1000;

/**
 * `sessions.cleanup`: every day, deletes expired sessions, invites that were used or expired more
 * than 30 days ago, ended rate-limit windows, and the discarded import previews with their files.
 * Idempotent: a second run finds nothing left. An active session is never touched. Every part runs
 * even when another failed; the run fails at the end if any did, so the queue retries it.
 */
export function createSessionsCleanupJob({
  identity,
  run,
  storageDir,
  now = () => new Date(),
}: TenantJobDeps) {
  return defineJob({
    name: 'sessions.cleanup',
    payload: z.object({}).strict(),
    schedule: { cron: '15 4 * * *', data: {} },
    singleton: { key: () => 'cleanup', dedupeSeconds: 3600 },
    async run(_payload, { log }) {
      const started = now();
      const failures: string[] = [];

      try {
        log.info({ ...(await cleanIdentity(identity, started)) }, 'identity cleaned');
      } catch (error) {
        if (error instanceof IdentityCleanupError) {
          log.warn(
            { ...error.done, failed_steps: error.failures },
            'identity cleaned with failures',
          );
          failures.push(...error.failures);
        } else {
          failures.push('identity');
        }
      }

      let removalFailures = 0;
      try {
        const poolIds = await poolsRepo.listIds(identity.db);
        await forEachPool(poolIds, ['imports.run'], log, async (ctx) => {
          const result = await cleanImportPreviews(
            ctx,
            started,
            (poolId, sha256) =>
              removeStoredFile(storageDir, poolId, sha256, { minAgeMs: FILE_MIN_AGE_MS }),
            run,
          );
          removalFailures += result.failed;
          if (result.batches > 0) log.info({ pool_id: ctx.poolId, ...result }, 'previews cleaned');
        });
      } catch {
        failures.push('previews');
      }
      if (removalFailures > 0) failures.push(`files:${String(removalFailures)}`);

      if (failures.length > 0) throw new CleanupError(failures);
    },
  });
}
