import { isUuid, sessionsRepo, type IdentityDatabase } from '@nestvault/db';

import { recordAccountAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { NotFoundError, UnauthorizedError } from '../errors';
import type { PoolLookup } from '../pools/pools-service';
import { clientIpResolver } from '../rate-limit/client-ip';

import { maskIp } from './mask-ip';
import {
  MeDto,
  MeWithPoolsDto,
  RevokedSessionsDto,
  SessionListDto,
  UpdateProfileInput,
  type SessionDto,
} from './schemas';
import { parseUserAgent } from './user-agent';

export interface AccountService {
  getMe(headers: Headers): Promise<MeWithPoolsDto>;
  updateProfile(headers: Headers, input: unknown): Promise<MeDto>;
  listSessions(headers: Headers): Promise<SessionListDto>;
  revokeSession(headers: Headers, sessionId: string): Promise<void>;
  revokeOtherSessions(headers: Headers): Promise<RevokedSessionsDto>;
}

/**
 * The signed-in user's own account: profile and sessions. Every function starts with the session
 * (guard 1) and only ever touches rows of that user; there is no pool here, the account is outside
 * every pool. Responses are built from the output schemas (no token, no hash).
 */
export function createAccountService(deps: {
  auth: Auth;
  identity: IdentityDatabase;
  pools: PoolLookup;
  /** Hops of the proxies we run; 0 (the default) records no address. */
  trustedProxyHops?: number;
}): AccountService {
  const { auth, identity, pools: poolsService } = deps;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

  async function current(headers: Headers) {
    const result = await auth.api.getSession({ headers });
    if (!result) throw new UnauthorizedError();
    return result;
  }

  const toMe = (user: { id: string; name: string; email: string; emailVerified: boolean }) =>
    MeDto.parse({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    });

  return {
    async getMe(headers) {
      const { user } = await current(headers);
      const userPools = await poolsService.listByUserId(user.id);
      return MeWithPoolsDto.parse({ ...toMe(user), pools: userPools });
    },

    async updateProfile(headers, input) {
      const { name } = UpdateProfileInput.parse(input);
      await current(headers);
      await auth.api.updateUser({ headers, body: { name } });
      return toMe((await current(headers)).user);
    },

    async listSessions(headers) {
      const { user, session } = await current(headers);
      const rows = await sessionsRepo.listActive(identity.db, user.id);
      const sessions: SessionDto[] = rows.map((row) => ({
        id: row.id,
        current: row.id === session.id,
        ...pick(parseUserAgent(row.userAgent)),
        ipMasked: maskIp(row.ipAddress),
        createdAt: row.createdAt.toISOString(),
        lastActiveAt: row.updatedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      }));
      return SessionListDto.parse({ sessions });
    },

    async revokeSession(headers, sessionId) {
      const { user } = await current(headers);
      // Someone else's id, an unknown id and a malformed one all answer the same: 404.
      if (!isUuid(sessionId)) throw new NotFoundError();
      if (!(await sessionsRepo.deleteOwned(identity.db, user.id, sessionId))) {
        throw new NotFoundError();
      }
      await recordAccountAudit(identity, 'session.revoked', {
        userId: user.id,
        target: sessionId,
        meta: { count: 1 },
        ip: ipOf(headers),
      });
    },

    async revokeOtherSessions(headers) {
      const { user, session } = await current(headers);
      const revoked = await sessionsRepo.deleteOthers(identity.db, user.id, session.id);
      if (revoked > 0) {
        await recordAccountAudit(identity, 'session.revoked', {
          userId: user.id,
          meta: { count: revoked },
          ip: ipOf(headers),
        });
      }
      return RevokedSessionsDto.parse({ revoked });
    },
  };
}

const pick = ({ browser, os, kind }: ReturnType<typeof parseUserAgent>) => ({ browser, os, kind });
