import {
  importBatchesRepo,
  invitesRepo,
  rateLimitsRepo,
  sessionsRepo,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
} from '@nestvault/db';

import { can } from '../guards/pool-access';

/** Invites that are over (used or expired) are kept this long before they are deleted. */
export const INVITE_RETENTION_DAYS = 30;
/** A discarded import is kept this long before it goes. */
export const PREVIEW_RETENTION_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IdentityCleanup {
  sessions: number;
  invites: number;
  rateWindows: number;
}

/**
 * Housekeeping of the identity database: sessions past their expiry, invites that were used or
 * expired more than 30 days ago, and rate-limit windows that have ended. A session that has not
 * expired is never deleted, and neither is an invite that can still be accepted.
 */
export async function cleanIdentity(
  identity: Pick<IdentityDatabase, 'db'>,
  now: Date,
): Promise<IdentityCleanup> {
  const cutoff = new Date(now.getTime() - INVITE_RETENTION_DAYS * DAY_MS);
  return {
    sessions: await sessionsRepo.deleteExpired(identity.db, now),
    invites: await invitesRepo.deleteStale(identity.db, cutoff),
    rateWindows: await rateLimitsRepo.deleteExpired(identity.db, now),
  };
}

/**
 * Deletes the pool's import batches discarded more than a week ago and the uploaded files nothing
 * else points at (the same file can belong to a committed batch). `removeFile` deletes one stored
 * statement. Returns the number of batches and files removed. Needs `imports.run`.
 */
export async function cleanImportPreviews(
  ctx: PoolContext,
  now: Date,
  removeFile: (poolId: string, sha256: string) => Promise<void>,
  run: PoolRunner = withPool,
): Promise<{ batches: number; files: number }> {
  can(ctx, 'imports.run');
  const cutoff = new Date(now.getTime() - PREVIEW_RETENTION_DAYS * DAY_MS);
  const result = await run(ctx, async (tx) => {
    const deleted = await importBatchesRepo.deleteDiscardedBefore(tx, ctx, cutoff);
    const hashes = [...new Set(deleted)];
    const inUse = new Set(await importBatchesRepo.hashesInUse(tx, ctx, hashes));
    return { batches: deleted.length, orphans: hashes.filter((hash) => !inUse.has(hash)) };
  });
  // Files go after the rows are committed: a crash in between leaves a file, never a row without one.
  for (const hash of result.orphans) await removeFile(ctx.poolId, hash);
  return { batches: result.batches, files: result.orphans.length };
}
