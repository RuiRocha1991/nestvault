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

/** Thrown after every step ran, so the queue retries the run; carries step names only. */
export class CleanupError extends Error {
  constructor(readonly failures: readonly string[]) {
    super(`cleanup failed: ${failures.join(', ')}`);
    this.name = 'CleanupError';
  }
}

/** A `CleanupError` that also says what the steps that worked deleted. */
export class IdentityCleanupError extends CleanupError {
  constructor(
    readonly done: IdentityCleanup,
    failures: readonly string[],
  ) {
    super(failures);
  }
}

/**
 * Housekeeping of the identity database: sessions past their expiry, invites that were used or
 * expired more than 30 days ago, and rate-limit windows that have ended. A session that has not
 * expired is never deleted, and neither is an invite that can still be accepted. Each step runs
 * on its own: a failing one does not skip the others, and the failures are reported together at the
 * end as an `IdentityCleanupError` (step names only, never the driver message).
 */
export async function cleanIdentity(
  identity: Pick<IdentityDatabase, 'db'>,
  now: Date,
): Promise<IdentityCleanup> {
  const cutoff = new Date(now.getTime() - INVITE_RETENTION_DAYS * DAY_MS);
  const result: IdentityCleanup = { sessions: 0, invites: 0, rateWindows: 0 };
  const failures: string[] = [];
  const step = async (name: keyof IdentityCleanup, work: () => Promise<number>) => {
    try {
      result[name] = await work();
    } catch {
      failures.push(name);
    }
  };
  await step('sessions', () => sessionsRepo.deleteExpired(identity.db, now));
  await step('invites', () => invitesRepo.deleteStale(identity.db, cutoff));
  await step('rateWindows', () => rateLimitsRepo.deleteExpired(identity.db, now));
  if (failures.length > 0) throw new IdentityCleanupError(result, failures);
  return result;
}

/**
 * Deletes the pool's import batches discarded more than a week ago and the uploaded files nothing
 * else points at (the same file can belong to a committed batch). `removeFile` deletes one stored
 * statement. Just before each removal the hash is checked again, so a batch created for the same
 * file in the meantime keeps it. A removal that fails is counted and the next file still goes;
 * `failed` says how many. Returns the batches and files removed. Needs `imports.run`.
 */
export async function cleanImportPreviews(
  ctx: PoolContext,
  now: Date,
  removeFile: (poolId: string, sha256: string) => Promise<unknown>,
  run: PoolRunner = withPool,
): Promise<{ batches: number; files: number; failed: number }> {
  can(ctx, 'imports.run');
  const cutoff = new Date(now.getTime() - PREVIEW_RETENTION_DAYS * DAY_MS);
  const result = await run(ctx, async (tx) => {
    const deleted = await importBatchesRepo.deleteDiscardedBefore(tx, ctx, cutoff);
    const hashes = [...new Set(deleted)];
    const inUse = new Set(await importBatchesRepo.hashesInUse(tx, ctx, hashes));
    return { batches: deleted.length, orphans: hashes.filter((hash) => !inUse.has(hash)) };
  });
  // Files go after the rows are committed: a crash in between leaves a file, never a row without one.
  let files = 0;
  let failed = 0;
  for (const hash of result.orphans) {
    try {
      const stillUsed = await run(ctx, (tx) => importBatchesRepo.hashesInUse(tx, ctx, [hash]));
      if (stillUsed.length > 0) continue;
      await removeFile(ctx.poolId, hash);
      files += 1;
    } catch {
      failed += 1;
    }
  }
  return { batches: result.batches, files, failed };
}
