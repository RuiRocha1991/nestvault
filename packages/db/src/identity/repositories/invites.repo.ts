import { and, desc, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { parseRole, type Role } from '../../pool-context';
import type { IdentityDatabase, IdentityExecutor } from '../client';
import { invites, pools, user } from '../schema';

export interface InviteRow {
  id: string;
  poolId: string;
  email: string;
  role: Role;
  expiresAt: Date;
  createdAt: Date;
}

/** What the invite page shows before anybody signs in: the pool, who invited and the role. */
export interface InvitePreviewRow extends InviteRow {
  poolName: string;
  /** `null` when the inviter's account no longer exists. */
  inviterName: string | null;
  acceptedAt: Date | null;
}

export interface NewInvite {
  id: string;
  poolId: string;
  email: string;
  role: Role;
  /** SHA-256 of the token; the token itself is never stored. */
  tokenHash: string;
  expiresAt: Date;
  invitedBy: string;
}

const COLUMNS = {
  id: invites.id,
  poolId: invites.poolId,
  email: invites.email,
  role: invites.role,
  expiresAt: invites.expiresAt,
  createdAt: invites.createdAt,
};

const toRow = <T extends { role: string }>(row: T): (Omit<T, 'role'> & { role: Role }) | null => {
  const role = parseRole(row.role);
  return role ? { ...row, role } : null;
};

/**
 * Invites live in the identity database, so there is no `PoolContext` here: every function that
 * acts on a pool takes the `poolId` the guard resolved and filters by it, so the id of an invite
 * of another pool matches nothing. Every value is a bound parameter.
 */
export const invitesRepo = {
  /**
   * Stores a new pending invite. A pool has one pending invite per address: when there is one it is
   * replaced (new id, token and expiry) in the same statement, so two parallel requests for the
   * same address cannot both insert.
   */
  async upsertPending(db: IdentityExecutor, invite: NewInvite): Promise<void> {
    await db
      .insert(invites)
      .values({
        id: invite.id,
        poolId: invite.poolId,
        email: invite.email,
        role: invite.role,
        tokenHash: invite.tokenHash,
        expiresAt: invite.expiresAt,
        invitedBy: invite.invitedBy,
      })
      .onConflictDoUpdate({
        target: [invites.poolId, invites.email],
        targetWhere: isNull(invites.acceptedAt),
        set: {
          id: invite.id,
          role: invite.role,
          tokenHash: invite.tokenHash,
          expiresAt: invite.expiresAt,
          invitedBy: invite.invitedBy,
          createdAt: sql`now()`,
        },
      });
  },

  /** The pool's invites that were neither accepted nor cancelled, newest first (expired ones too). */
  async listPending(db: IdentityDatabase['db'], poolId: string): Promise<InviteRow[]> {
    const rows = await db
      .select(COLUMNS)
      .from(invites)
      .where(and(eq(invites.poolId, poolId), isNull(invites.acceptedAt)))
      .orderBy(desc(invites.createdAt), desc(invites.id));
    return rows.flatMap((row) => toRow(row) ?? []);
  },

  /** One pending invite of the pool; `null` for another pool's id, an accepted or a cancelled one. */
  async findPending(
    db: IdentityExecutor,
    poolId: string,
    inviteId: string,
  ): Promise<InviteRow | null> {
    const [row] = await db
      .select(COLUMNS)
      .from(invites)
      .where(and(eq(invites.id, inviteId), eq(invites.poolId, poolId), isNull(invites.acceptedAt)))
      .limit(1);
    return row ? toRow(row) : null;
  },

  /** Cancels a pending invite by deleting it. `false` when there was no such pending invite. */
  async deletePending(db: IdentityExecutor, poolId: string, inviteId: string): Promise<boolean> {
    const deleted = await db
      .delete(invites)
      .where(and(eq(invites.id, inviteId), eq(invites.poolId, poolId), isNull(invites.acceptedAt)))
      .returning({ id: invites.id });
    return deleted.length > 0;
  },

  /** Gives a pending invite a new token and expiry (resend). `null` when it is not pending. */
  async rotateToken(
    db: IdentityExecutor,
    poolId: string,
    inviteId: string,
    next: { tokenHash: string; expiresAt: Date },
  ): Promise<InviteRow | null> {
    const [row] = await db
      .update(invites)
      .set({ tokenHash: next.tokenHash, expiresAt: next.expiresAt })
      .where(and(eq(invites.id, inviteId), eq(invites.poolId, poolId), isNull(invites.acceptedAt)))
      .returning(COLUMNS);
    return row ? toRow(row) : null;
  },

  /** The invite behind a token hash, with the pool name and the inviter. Validity is the caller's call. */
  async findPreviewByTokenHash(
    db: IdentityExecutor,
    tokenHash: string,
  ): Promise<InvitePreviewRow | null> {
    const [row] = await db
      .select({
        ...COLUMNS,
        poolName: pools.name,
        inviterName: user.name,
        acceptedAt: invites.acceptedAt,
      })
      .from(invites)
      .innerJoin(pools, eq(pools.id, invites.poolId))
      .leftJoin(user, eq(user.id, invites.invitedBy))
      .where(eq(invites.tokenHash, tokenHash))
      .limit(1);
    return row ? toRow(row) : null;
  },

  /**
   * Uses the invite up. The `where` makes this the single-use switch: of two parallel accepts only
   * one updates a row, the other gets `false`. Call it in the transaction that adds the member.
   */
  async markAccepted(db: IdentityExecutor, inviteId: string, now: Date): Promise<boolean> {
    const updated = await db
      .update(invites)
      .set({ acceptedAt: now })
      .where(and(eq(invites.id, inviteId), isNull(invites.acceptedAt), gt(invites.expiresAt, now)))
      .returning({ id: invites.id });
    return updated.length > 0;
  },

  /**
   * Deletes the invites that are over: accepted before `cutoff`, or never accepted and expired before
   * it. A pending invite that can still be used is never touched. Returns how many went.
   */
  async deleteStale(db: IdentityExecutor, cutoff: Date): Promise<number> {
    const rows = await db
      .delete(invites)
      .where(
        or(
          and(isNotNull(invites.acceptedAt), lt(invites.acceptedAt, cutoff)),
          and(isNull(invites.acceptedAt), lt(invites.expiresAt, cutoff)),
        ),
      )
      .returning({ id: invites.id });
    return rows.length;
  },
};
