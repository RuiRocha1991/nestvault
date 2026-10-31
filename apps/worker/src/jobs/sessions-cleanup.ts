import { poolsRepo } from '@nestvault/db';
import { cleanIdentity, cleanImportPreviews, removeStoredFile } from '@nestvault/services';
import { z } from 'zod';

import { forEachPool } from '../pools';

import { defineJob } from './define';
import type { TenantJobDeps } from './tenant';

/**
 * `sessions.cleanup`: every day, deletes expired sessions, invites that were used or expired more
 * than 30 days ago, ended rate-limit windows, and the discarded import previews with their files.
 * Idempotent: a second run finds nothing left. An active session is never touched.
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
      const identityResult = await cleanIdentity(identity, started);
      log.info({ ...identityResult }, 'identity cleaned');
      const poolIds = await poolsRepo.listIds(identity.db);
      await forEachPool(poolIds, ['imports.run'], log, async (ctx) => {
        const result = await cleanImportPreviews(
          ctx,
          started,
          (poolId, sha256) => removeStoredFile(storageDir, poolId, sha256),
          run,
        );
        if (result.batches > 0) log.info({ pool_id: ctx.poolId, ...result }, 'previews cleaned');
      });
    },
  });
}
