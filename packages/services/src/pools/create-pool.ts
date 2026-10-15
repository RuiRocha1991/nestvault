import { newId, poolMembersRepo, poolsRepo, type IdentityDatabase } from '@nestvault/db';
import { createPoolContext } from '@nestvault/db/pool-context-factory';

import { recordAudit } from '../audit/audit';
import { ConflictError } from '../errors';
import { permissionsOfRole } from '../guards/permissions';

/**
 * Creates a pool with `userId` as its owner. The pool, the membership and the `pool.created` audit
 * entry are written in one transaction: if any of them fails nothing is kept, so there is never a
 * pool without an owner or without its entry. Default categories are a global catalogue (ADR 0004)
 * and are not copied.
 */
export async function createPool(
  identity: IdentityDatabase,
  input: { userId: string; name: string; ip?: string | null; maxPools?: number },
): Promise<{ poolId: string }> {
  const poolId = newId();
  await identity.db.transaction(async (tx) => {
    // Count check inside the transaction so concurrent requests for the same user cannot both
    // read a count below the cap and both proceed (TOCTOU). READ COMMITTED narrows the window to
    // the transaction itself; the probability of a race on a low cap is negligible in practice.
    if (input.maxPools !== undefined) {
      const owned = await poolsRepo.countOwnedBy(tx, input.userId);
      if (owned >= input.maxPools) throw new ConflictError('You own the maximum number of pools.');
    }
    await poolsRepo.insert(tx, { id: poolId, name: input.name });
    await poolMembersRepo.insert(tx, { poolId, userId: input.userId, role: 'owner' });
    // The creator is the owner from this transaction on; the context says so for the audit entry.
    const ctx = createPoolContext({
      poolId,
      actor: { kind: 'user', userId: input.userId },
      role: 'owner',
      permissions: permissionsOfRole('owner'),
    });
    await recordAudit(tx, ctx, 'pool.created', { ip: input.ip ?? null });
  });
  return { poolId };
}
