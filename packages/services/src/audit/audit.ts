import { auditLogRepo, isUuid } from '@nestvault/db';
import type { IdentityDatabase, PoolContext } from '@nestvault/db';

import { logger } from '../logger';
import { UNTRUSTED_CLIENT_KEY } from '../rate-limit';

import type { AccountAuditAction, PoolAuditAction } from './actions';
import { isSafeAuditText, sanitizeAuditMeta } from './meta';

export interface AuditDetails {
  /** An id (user, invite, session). Anything that is not a short code is not stored. */
  target?: string | null;
  /** Filtered through the allow-list. */
  meta?: unknown;
  /** The client address; the placeholder for "unknown" is not stored. */
  ip?: string | null;
}

const clean = (details: AuditDetails) => ({
  target: isSafeAuditText(details.target) ? details.target : null,
  ip: details.ip && details.ip !== UNTRUSTED_CLIENT_KEY ? details.ip.slice(0, 45) : null,
  meta: sanitizeAuditMeta(details.meta),
});

/**
 * Writes one entry for an action inside a pool. Pool and actor come from the `PoolContext`, never
 * from the caller. Throws when the write fails: a pool action that cannot be recorded must not
 * look done, so the service calls it before answering.
 */
export async function recordAudit(
  identity: IdentityDatabase,
  ctx: PoolContext,
  action: PoolAuditAction,
  details: AuditDetails = {},
): Promise<void> {
  await auditLogRepo.insert(identity.db, {
    poolId: ctx.poolId,
    userId: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
    action,
    ...clean(details),
  });
}

/**
 * Writes one entry for an account action (sign-in, password, sessions). `userId` is null when
 * nobody could be identified (a failed sign-in). A failure here is logged and swallowed: losing an
 * entry must not lock anybody out of their account.
 */
export async function recordAccountAudit(
  identity: IdentityDatabase,
  action: AccountAuditAction,
  details: AuditDetails & { userId: string | null },
): Promise<void> {
  try {
    await auditLogRepo.insert(identity.db, {
      poolId: null,
      userId: details.userId && isUuid(details.userId) ? details.userId : null,
      action,
      ...clean(details),
    });
  } catch (error) {
    logger.error({ err: error, action }, 'could not write the audit entry');
  }
}
