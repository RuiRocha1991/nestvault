import { isUuid, poolMembersRepo, sessionsRepo, usersRepo } from '@nestvault/db';
import type { IdentityDatabase, Role } from '@nestvault/db';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { verifyPassword } from '../auth/passwords';
import { requireSession } from '../auth/require-session';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import {
  canActOnMember,
  canAssignRole,
  canAssignRoleAs,
  HANDOVER_ROLES,
  holdsOwnerRights,
  leavesNoOwner,
  sameRole,
} from '../guards/permissions';
import { can, requirePoolAccess } from '../guards/pool-access';
import { clientIpResolver, type RateLimiter } from '../rate-limit';

import {
  MemberListDto,
  MemberRoleDto,
  toMemberDto,
  TransferOwnershipDto,
  TransferOwnershipInput,
  UpdateMemberRoleInput,
} from './schemas';

export interface MembersService {
  /** The pool's members. Needs only membership; emails are filled for `members.manage`. */
  list(headers: Headers, poolId: string): Promise<MemberListDto>;
  /** Changes another member's role and ends their sessions in the pool (`members.manage`). */
  changeRole(
    headers: Headers,
    poolId: string,
    userId: string,
    input: unknown,
  ): Promise<MemberRoleDto>;
  /** Removes another member and ends their sessions in the pool (`members.manage`). */
  remove(headers: Headers, poolId: string, userId: string): Promise<void>;
  /** The caller leaves the pool. The last owner cannot (409). */
  leave(headers: Headers, poolId: string): Promise<void>;
  /** An owner hands the pool to another member after confirming their password (`pool.transfer`). */
  transferOwnership(
    headers: Headers,
    poolId: string,
    input: unknown,
  ): Promise<TransferOwnershipDto>;
}

export interface MembersServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  limiter: RateLimiter;
  trustedProxyHops?: number;
}

interface Member {
  userId: string;
  role: Role;
}

const NEEDS_AN_OWNER = 'A pool needs at least one owner.';

/**
 * The membership rows are locked for the whole transaction, so the rules below are checked against
 * what is true now, not against what the guard saw a moment earlier: the caller's role is read
 * again from the locked rows, and two parallel requests cannot both leave the pool without an owner.
 */
function find(locked: readonly Member[], userId: string): Member {
  const found = locked.find((member) => member.userId === userId);
  if (!found) throw new NotFoundError();
  return found;
}

export function createMembersService(deps: MembersServiceDeps): MembersService {
  const { auth, identity, limiter } = deps;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

  const parseUserId = (userId: string) => {
    if (!isUuid(userId)) throw new NotFoundError();
    return userId.toLowerCase();
  };

  /**
   * The caller proves who they are with their password before a change that hands out the pool.
   * Wrong guesses share the budget of the other password checks of the account (429); a success
   * gives its hit back. A missing or wrong password answers 400 with an issue on `password` only.
   */
  async function confirmPassword(userId: string, password: string | undefined): Promise<void> {
    const refused = () =>
      new ValidationError('The request is not valid.', [
        { path: 'password', message: 'incorrect' },
      ]);
    if (password === undefined) throw refused();
    const hit = await limiter.consume('auth.account.user', userId);
    const stored = await usersRepo.passwordHashOf(identity.db, userId);
    if (stored === null || !(await verifyPassword({ hash: stored, password }))) throw refused();
    await hit.release();
  }

  return {
    async list(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const rows = await poolMembersRepo.listMembers(identity.db, ctx.poolId);
      const me = rows.find((row) => row.userId === session.userId);
      if (!me) throw new NotFoundError();
      const showEmail = ctx.permissions.has('members.manage');
      return MemberListDto.parse({
        members: rows.map((row) => toMemberDto(row, me, showEmail)),
      });
    },

    async changeRole(headers, poolId, userId, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateMemberRoleInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'members.manage');
      const targetId = parseUserId(userId);
      const next = parsed.data.role;
      // Making an owner is as weighty as handing the pool over: the caller confirms their password.
      let passwordConfirmed = false;
      if (holdsOwnerRights(next)) {
        // An admin is refused before being asked for a password (the locked check below stays).
        if (!canAssignRole(ctx, next)) throw new ForbiddenError();
        // Unlocked and cheap: an unknown person or a role they already have costs no password attempt.
        const current = await poolMembersRepo.findRole(identity.db, ctx.poolId, targetId);
        if (current === null) throw new NotFoundError();
        if (!sameRole(current, next)) {
          await confirmPassword(session.userId, parsed.data.password);
          passwordConfirmed = true;
        }
      }

      await identity.db.transaction(async (tx) => {
        const locked = await poolMembersRepo.lockMembers(tx, ctx.poolId);
        const actor = find(locked, session.userId);
        const target = find(locked, targetId);
        // Not yourself (the owner hands the pool over instead), and only an owner touches an owner.
        if (!canActOnMember(actor, target)) throw new ForbiddenError();
        // Nobody hands out a role above their own: an admin cannot make an owner.
        if (!canAssignRoleAs(actor.role, next)) throw new ForbiddenError();
        if (sameRole(target.role, next)) return;
        if (leavesNoOwner(locked, target, next)) throw new ConflictError(NEEDS_AN_OWNER);
        // The role changed after the unlocked check: never make an owner without the password.
        if (holdsOwnerRights(next) && !passwordConfirmed) {
          throw new ConflictError('The member changed in the meantime. Try again.');
        }
        await poolMembersRepo.updateRole(tx, ctx.poolId, targetId, next);
        await sessionsRepo.endInPool(tx, targetId, ctx.poolId);
        await recordAudit(tx, ctx, 'member.role_changed', {
          target: targetId,
          meta: { targetUserId: targetId, previousRole: target.role, role: next },
          ip: ipOf(headers),
        });
      });
      return MemberRoleDto.parse({ id: targetId, role: next });
    },

    async remove(headers, poolId, userId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'members.manage');
      const targetId = parseUserId(userId);

      await identity.db.transaction(async (tx) => {
        const locked = await poolMembersRepo.lockMembers(tx, ctx.poolId);
        const actor = find(locked, session.userId);
        const target = find(locked, targetId);
        // Leaving is its own action, with its own audit entry and its own rules.
        if (!canActOnMember(actor, target)) throw new ForbiddenError();
        if (leavesNoOwner(locked, target, null)) throw new ConflictError(NEEDS_AN_OWNER);
        await poolMembersRepo.remove(tx, ctx.poolId, targetId);
        await sessionsRepo.endInPool(tx, targetId, ctx.poolId);
        await recordAudit(tx, ctx, 'member.removed', {
          target: targetId,
          meta: { targetUserId: targetId, previousRole: target.role },
          ip: ipOf(headers),
        });
      });
    },

    async leave(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);

      await identity.db.transaction(async (tx) => {
        const locked = await poolMembersRepo.lockMembers(tx, ctx.poolId);
        const me = find(locked, session.userId);
        if (leavesNoOwner(locked, me, null)) {
          throw new ConflictError('You are the only owner. Transfer the pool before leaving.');
        }
        await poolMembersRepo.remove(tx, ctx.poolId, session.userId);
        await sessionsRepo.clearActivePool(tx, session.userId, ctx.poolId);
        await recordAudit(tx, ctx, 'member.left', {
          target: session.userId,
          meta: { previousRole: me.role },
          ip: ipOf(headers),
        });
      });
    },

    async transferOwnership(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = TransferOwnershipInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.transfer');
      const targetId = parseUserId(parsed.data.userId);
      if (targetId === session.userId) throw new ValidationError();

      // Unlocked and cheap: a stranger or somebody who already owns the pool costs no password
      // attempt. The locked checks below stay the real guard.
      const current = await poolMembersRepo.findRole(identity.db, ctx.poolId, targetId);
      if (current === null) throw new NotFoundError();
      if (holdsOwnerRights(current)) throw new ConflictError('This person already owns the pool.');
      await confirmPassword(session.userId, parsed.data.password);

      const keepOwnership = parsed.data.keepOwnership === true;
      await identity.db.transaction(async (tx) => {
        const locked = await poolMembersRepo.lockMembers(tx, ctx.poolId);
        const actor = find(locked, session.userId);
        const target = find(locked, targetId);
        if (!holdsOwnerRights(actor.role)) throw new ForbiddenError();
        if (holdsOwnerRights(target.role)) {
          throw new ConflictError('This person already owns the pool.');
        }
        await poolMembersRepo.updateRole(tx, ctx.poolId, targetId, HANDOVER_ROLES.incoming);
        if (!keepOwnership) {
          await poolMembersRepo.updateRole(tx, ctx.poolId, session.userId, HANDOVER_ROLES.outgoing);
        }
        await sessionsRepo.endInPool(tx, targetId, ctx.poolId);
        await recordAudit(tx, ctx, 'pool.ownership_transferred', {
          target: targetId,
          meta: {
            targetUserId: targetId,
            previousRole: target.role,
            role: HANDOVER_ROLES.incoming,
            actorRole: keepOwnership ? HANDOVER_ROLES.incoming : HANDOVER_ROLES.outgoing,
            ...(keepOwnership ? { reason: 'kept_owner' } : {}),
          },
          ip: ipOf(headers),
        });
      });
      return TransferOwnershipDto.parse({
        poolId: ctx.poolId,
        role: keepOwnership ? HANDOVER_ROLES.incoming : HANDOVER_ROLES.outgoing,
      });
    },
  };
}
