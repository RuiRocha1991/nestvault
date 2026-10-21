import { poolsRepo, sessionsRepo, type IdentityDatabase, type Role } from '@nestvault/db';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { NotFoundError, ValidationError } from '../errors';
import { permissionsFor, type Permission } from '../guards/permissions';
import { can, requirePoolAccess } from '../guards/pool-access';
import { clientIpResolver } from '../rate-limit/client-ip';

import { createPool } from './create-pool';
import {
  CreatePoolInput,
  PoolListDto,
  PoolSummaryDto,
  RenamePoolInput,
  toPoolSummaryDto,
} from './schemas';

/** A person who owns this many pools cannot create another one (a guard against runaway scripts). */
export const MAX_OWNED_POOLS = 10;

export interface PoolsService {
  /** The pools of the signed-in user and the one the session worked in last. */
  listMine(headers: Headers): Promise<PoolListDto>;
  /** Creates a pool; the caller becomes its owner. */
  create(headers: Headers, input: unknown): Promise<PoolSummaryDto>;
  /** One pool of the caller (guards 1 and 3: 401 without a session, 404 for a non-member). */
  open(headers: Headers, poolId: string): Promise<PoolSummaryDto>;
  /** Renames the pool (`pool.rename`: owners only). Audited with the pool id, never the name. */
  rename(headers: Headers, poolId: string, input: unknown): Promise<PoolSummaryDto>;
  /** What the caller may do in the pool, so pages can hide actions (cosmetic; services enforce). */
  permissions(headers: Headers, poolId: string): Promise<readonly Permission[]>;
}

/**
 * Internal extension for cross-service use. Not on `PoolsService` so routes (which hold a
 * `PoolsService` reference) cannot call it without a session guard.
 */
export interface PoolLookup {
  listByUserId(userId: string): Promise<readonly PoolSummaryDto[]>;
}

export function createPoolsService(deps: {
  auth: Auth;
  identity: IdentityDatabase;
  trustedProxyHops?: number;
}): PoolsService & PoolLookup {
  const { auth, identity } = deps;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

  return {
    async listByUserId(userId) {
      const rows = await poolsRepo.listForUser(identity.db, userId);
      return rows.map(toPoolSummaryDto);
    },

    async listMine(headers) {
      const session = await requireSession(auth, headers);
      const [rows, active] = await Promise.all([
        poolsRepo.listForUser(identity.db, session.userId),
        sessionsRepo.activePool(identity.db, session.userId, session.sessionId),
      ]);
      const pools = rows.map(toPoolSummaryDto);
      return PoolListDto.parse({
        pools,
        activePoolId: pools.some((pool) => pool.id === active) ? active : null,
      });
    },

    async create(headers, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreatePoolInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const { poolId } = await createPool(identity, {
        userId: session.userId,
        name: parsed.data.name,
        ip: ipOf(headers),
        maxPools: MAX_OWNED_POOLS,
      });
      // Build the DTO from what we already know: avoids a second DB round-trip and a spurious 404
      // if findForUser were to fail after a successful commit.
      const now = new Date().toISOString();
      return PoolSummaryDto.parse({
        id: poolId,
        name: parsed.data.name,
        role: 'owner',
        memberCount: 1,
        lastActivityAt: now,
        createdAt: now,
      });
    },

    async rename(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = RenamePoolInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.rename');
      await identity.db.transaction(async (tx) => {
        if (!(await poolsRepo.rename(tx, ctx.poolId, parsed.data.name))) throw new NotFoundError();
        await recordAudit(tx, ctx, 'pool.renamed', { target: ctx.poolId, ip: ipOf(headers) });
      });
      const found = await poolsRepo.findById(identity.db, ctx.poolId);
      if (!found) throw new NotFoundError();
      return toPoolSummaryDto({ ...found, role: ctx.role as Role });
    },

    async permissions(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      return [...permissionsFor(ctx)];
    },

    async open(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      const found = await poolsRepo.findById(identity.db, ctx.poolId);
      if (!found) throw new NotFoundError();
      // requirePoolAccess ensures ctx.role is a member Role, never 'system': safe to assert.
      return toPoolSummaryDto({ ...found, role: ctx.role as Role });
    },
  };
}
