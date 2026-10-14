import { isUuidV7, poolMembersRepo, sessionsRepo } from '@nestvault/db';
import type { IdentityDatabase, PoolContext } from '@nestvault/db';
import { createPoolContext } from '@nestvault/db/pool-context-factory';

import type { AuthSession } from '../auth/require-session';
import { ForbiddenError, NotFoundError } from '../errors';
import { logger } from '../logger';

import { permissionsOfRole, PERMISSIONS } from './permissions';
import type { Permission } from './permissions';

/**
 * Guard 3 (session → validation → pool → permission). Returns the `PoolContext` for a member and
 * throws the same `NotFoundError` for a malformed id, a pool that does not exist and a pool the
 * caller does not belong to, so the existence of a pool is never confirmed. All three take one
 * indexed lookup (the malformed id skips it, which tells nothing about any real pool).
 *
 * Also remembers the pool as the session's active one; a failure there never blocks the request.
 */
export async function requirePoolAccess(
  identity: IdentityDatabase,
  session: Pick<AuthSession, 'userId' | 'sessionId'>,
  poolId: string,
): Promise<PoolContext> {
  if (!isUuidV7(poolId)) throw new NotFoundError();
  const role = await poolMembersRepo.findRole(identity.db, poolId, session.userId);
  if (!role) throw new NotFoundError();
  await sessionsRepo
    .setActivePool(identity.db, session.userId, session.sessionId, poolId.toLowerCase())
    .catch((error: unknown) => {
      logger.warn({ err: error }, 'could not remember the active pool');
    });
  return createPoolContext({
    poolId,
    actor: { kind: 'user', userId: session.userId },
    role,
    permissions: permissionsOfRole(role),
  });
}

/**
 * Guard 4. Throws `ForbiddenError` (403) unless the caller's role grants `permission`. `resource`
 * is accepted and ignored until `member_rules` exists (phase 4), so callers can already pass it.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `resource` is part of the contract
export function can(ctx: PoolContext, permission: Permission, resource?: unknown): void {
  if (!ctx.permissions.has(permission)) throw new ForbiddenError();
}

/** Context for background work (worker jobs) that acts as the system with an explicit grant. */
export function systemContext(poolId: string, permissions: readonly Permission[]): PoolContext {
  return createPoolContext({
    poolId,
    actor: { kind: 'system' },
    role: 'system',
    permissions: permissions.filter((permission) => PERMISSIONS.includes(permission)),
  });
}
