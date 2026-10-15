import { invitesRepo, isUuid, newId, poolMembersRepo, poolsRepo } from '@nestvault/db';
import type { IdentityDatabase, InvitePreviewRow } from '@nestvault/db';
import { createPoolContext } from '@nestvault/db/pool-context-factory';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { getEmailStatus } from '../auth/email-tokens';
import { requireSession } from '../auth/require-session';
import type { InviteVerifier } from '../auth/signup-policy';
import { inviteTemplate, type EmailSender } from '../email';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../errors';
import { canAssignRole, permissionsOfRole } from '../guards/permissions';
import { can, requirePoolAccess } from '../guards/pool-access';
import { logger } from '../logger';
import { clientIpResolver, type RateLimiter } from '../rate-limit';

import {
  AcceptInviteDto,
  CreateInviteInput,
  InviteListDto,
  toInviteDto,
  toInvitePreviewDto,
  type InviteDto,
  type InvitePreviewDto,
} from './schemas';
import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TTL_MS,
  inviteLink,
  isInviteTokenShape,
} from './tokens';

export interface InvitesService {
  /** Invites `email` to the pool with `role` and emails the link (guards 1-4, 20 invites a day per pool). */
  create(headers: Headers, poolId: string, input: unknown): Promise<InviteDto>;
  /** The pool's pending invites, newest first. */
  listPending(headers: Headers, poolId: string): Promise<InviteListDto>;
  /** Cancels a pending invite; its link stops working. */
  cancel(headers: Headers, poolId: string, inviteId: string): Promise<void>;
  /** Gives a pending invite a new link and expiry and emails it again. */
  resend(headers: Headers, poolId: string, inviteId: string): Promise<InviteDto>;
  /**
   * What the public invite page shows. `null` for an unknown, expired, used or malformed token (the
   * page cannot tell which, so it never says) and when the lookup limit is exceeded.
   */
  preview(headers: Headers, token: string): Promise<InvitePreviewDto | null>;
  /**
   * Accepts an invite as the signed-in user. Everything that is not "valid invite for this
   * account's verified address" is the same 404, so the endpoint confirms nothing about a token.
   */
  accept(headers: Headers, token: string): Promise<AcceptInviteDto>;
}

export interface InvitesServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  limiter: RateLimiter;
  email: EmailSender;
  appUrl: string;
  trustedProxyHops?: number;
  /** Tests move the clock. */
  now?: () => Date;
}

const isOpen = (invite: Pick<InvitePreviewRow, 'acceptedAt' | 'expiresAt'>, now: Date) =>
  invite.acceptedAt === null && invite.expiresAt.getTime() > now.getTime();

/**
 * The sign-up check of a closed instance: a valid invite for exactly this address lets the person
 * register. The token is looked up by its hash.
 */
export function createInviteVerifier(
  identity: IdentityDatabase,
  now: () => Date = () => new Date(),
): InviteVerifier {
  return {
    async isValid({ token, email }) {
      if (!isInviteTokenShape(token)) return false;
      const found = await invitesRepo.findPreviewByTokenHash(identity.db, hashInviteToken(token));
      return (
        !!found && isOpen(found, now()) && found.email.toLowerCase() === email.trim().toLowerCase()
      );
    },
  };
}

export function createInvitesService(deps: InvitesServiceDeps): InvitesService {
  const { auth, identity, limiter, email, appUrl } = deps;
  const now = deps.now ?? (() => new Date());
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

  /** Sends after the commit. A failure is logged and never undoes the invite: the inviter can resend. */
  async function sendInvite(input: {
    to: string;
    inviter: string;
    poolName: string;
    token: string;
  }): Promise<void> {
    try {
      await email.send({
        to: input.to,
        ...inviteTemplate({
          inviter: input.inviter,
          poolName: input.poolName,
          url: inviteLink(appUrl, input.token),
        }),
      });
    } catch {
      logger.warn('could not send an invite email');
    }
  }

  /** Guards 1-4 for the actions on a pool's invites; the role check keeps admins away from owner invites. */
  async function guard(headers: Headers, poolId: string) {
    const session = await requireSession(auth, headers);
    const ctx = await requirePoolAccess(identity, session, poolId);
    can(ctx, 'members.invite');
    return { session, ctx };
  }

  const parseInviteId = (inviteId: string) => {
    if (!isUuid(inviteId)) throw new NotFoundError();
    return inviteId.toLowerCase();
  };

  return {
    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateInviteInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'members.invite');
      if (!canAssignRole(ctx, parsed.data.role)) throw new ForbiddenError();
      await limiter.consume('invites', ctx.poolId);

      const pool = await poolsRepo.findById(identity.db, ctx.poolId);
      if (!pool) throw new NotFoundError();
      const token = generateInviteToken();
      const invite = {
        id: newId(),
        poolId: ctx.poolId,
        email: parsed.data.email,
        role: parsed.data.role,
        tokenHash: hashInviteToken(token),
        expiresAt: new Date(now().getTime() + INVITE_TTL_MS),
        invitedBy: session.userId,
      };
      await identity.db.transaction(async (tx) => {
        if (await poolMembersRepo.existsByEmail(tx, ctx.poolId, invite.email)) {
          throw new ConflictError('This person is already a member of the pool.');
        }
        await invitesRepo.upsertPending(tx, invite);
        await recordAudit(tx, ctx, 'invite.created', {
          target: invite.id,
          meta: { inviteId: invite.id, role: invite.role },
          ip: ipOf(headers),
        });
      });
      await sendInvite({ to: invite.email, inviter: session.name, poolName: pool.name, token });
      return toInviteDto({ ...invite, createdAt: now() });
    },

    async listPending(headers, poolId) {
      const { ctx } = await guard(headers, poolId);
      const rows = await invitesRepo.listPending(identity.db, ctx.poolId);
      return InviteListDto.parse({ invites: rows.map(toInviteDto) });
    },

    async cancel(headers, poolId, inviteId) {
      const { ctx } = await guard(headers, poolId);
      const id = parseInviteId(inviteId);
      await identity.db.transaction(async (tx) => {
        const pending = await invitesRepo.findPending(tx, ctx.poolId, id);
        if (!pending) throw new NotFoundError();
        if (!canAssignRole(ctx, pending.role)) throw new ForbiddenError();
        if (!(await invitesRepo.deletePending(tx, ctx.poolId, id))) throw new NotFoundError();
        await recordAudit(tx, ctx, 'invite.cancelled', {
          target: id,
          meta: { inviteId: id, role: pending.role },
          ip: ipOf(headers),
        });
      });
    },

    async resend(headers, poolId, inviteId) {
      const { session, ctx } = await guard(headers, poolId);
      const id = parseInviteId(inviteId);
      const pool = await poolsRepo.findById(identity.db, ctx.poolId);
      if (!pool) throw new NotFoundError();
      const current = await invitesRepo.findPending(identity.db, ctx.poolId, id);
      if (!current) throw new NotFoundError();
      if (!canAssignRole(ctx, current.role)) throw new ForbiddenError();
      await limiter.consume('invites', ctx.poolId);

      const token = generateInviteToken();
      const rotated = await identity.db.transaction(async (tx) => {
        const row = await invitesRepo.rotateToken(tx, ctx.poolId, id, {
          tokenHash: hashInviteToken(token),
          expiresAt: new Date(now().getTime() + INVITE_TTL_MS),
        });
        if (!row) throw new NotFoundError();
        await recordAudit(tx, ctx, 'invite.created', {
          target: id,
          meta: { inviteId: id, role: row.role, reason: 'resend' },
          ip: ipOf(headers),
        });
        return row;
      });
      await sendInvite({ to: rotated.email, inviter: session.name, poolName: pool.name, token });
      return toInviteDto(rotated);
    },

    async preview(headers, token) {
      if (!isInviteTokenShape(token)) return null;
      try {
        const ip = ipOf(headers);
        await limiter.consume('invites.lookup', ip);
      } catch (error) {
        if (error instanceof RateLimitError) return null;
        throw error;
      }
      const found = await invitesRepo.findPreviewByTokenHash(identity.db, hashInviteToken(token));
      return found && isOpen(found, now()) ? toInvitePreviewDto(found) : null;
    },

    async accept(headers, token) {
      const session = await requireSession(auth, headers);
      if (!isInviteTokenShape(token)) throw new NotFoundError();
      const [found, status] = await Promise.all([
        invitesRepo.findPreviewByTokenHash(identity.db, hashInviteToken(token)),
        getEmailStatus(auth, headers),
      ]);
      const at = now();
      if (!found || !isOpen(found, at)) throw new NotFoundError();
      if (!status?.emailVerified || status.email.toLowerCase() !== found.email.toLowerCase()) {
        throw new NotFoundError();
      }

      await identity.db.transaction(async (tx) => {
        // Single use: only one of two parallel accepts updates the row; the other gets a 404.
        if (!(await invitesRepo.markAccepted(tx, found.id, at))) throw new NotFoundError();
        await poolMembersRepo.insertIfAbsent(tx, {
          poolId: found.poolId,
          userId: session.userId,
          role: found.role,
        });
        const ctx = createPoolContext({
          poolId: found.poolId,
          actor: { kind: 'user', userId: session.userId },
          role: found.role,
          permissions: permissionsOfRole(found.role),
        });
        await recordAudit(tx, ctx, 'invite.accepted', {
          target: found.id,
          meta: { inviteId: found.id, role: found.role },
          ip: ipOf(headers),
        });
      });
      return AcceptInviteDto.parse({ poolId: found.poolId });
    },
  };
}
