import type { IdentityDatabase } from '@nestvault/db';

import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { ValidationError } from '../errors';
import { requirePoolAccess } from '../guards/pool-access';

import { AuditQuery } from './list';
import { listAuditScreen, type AuditScreenDto } from './screen';

export interface AuditService {
  /**
   * One page of the pool's audit log with its filters applied (owner only). Guards in order: 401
   * without a session, 400 for a bad query, 404 for a non-member, 403 without `audit.read`.
   */
  screen(headers: Headers, poolId: string, query: unknown): Promise<AuditScreenDto>;
}

export function createAuditService(deps: { auth: Auth; identity: IdentityDatabase }): AuditService {
  const { auth, identity } = deps;
  return {
    async screen(headers, poolId, query) {
      const session = await requireSession(auth, headers);
      if (!AuditQuery.safeParse(query ?? {}).success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      return listAuditScreen(identity, ctx, query);
    },
  };
}
