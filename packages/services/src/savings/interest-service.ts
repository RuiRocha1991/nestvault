import {
  accountsRepo,
  depositsRepo,
  interestEntriesRepo,
  newId,
  withPool,
  type IdentityDatabase,
  type PoolRunner,
} from '@nestvault/db';
import { isScheduled } from '@nestvault/domain';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { ConflictError, NotFoundError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { invalid, parseId } from '../investments/checks';
import { clientIpResolver } from '../rate-limit/client-ip';
import { zodProblem } from '../zod-problem';

import { toDomainDeposit } from './domain';
import {
  CreateInterestInput,
  InterestEntryDto,
  InterestListDto,
  ListInterestQuery,
  toInterestDto,
} from './schemas';

export interface InterestService {
  /** Interest entries, newest first, optionally of one account (any member). */
  list(headers: Headers, poolId: string, query?: unknown): Promise<InterestListDto>;
  /**
   * Records interest received by a savings account, or by a term deposit without a payment
   * schedule (`accounts.write`). A scheduled deposit gets its interest from the schedule.
   */
  create(headers: Headers, poolId: string, input: unknown): Promise<InterestEntryDto>;
  /** Deletes an entry (`accounts.write`). */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
}

export interface InterestServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
}

export function createInterestService(deps: InterestServiceDeps): InterestService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

  return {
    async list(headers, poolId, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = ListInterestQuery.safeParse(query);
      if (!parsed.success) throw zodProblem(parsed.error, query);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const rows = await run(ctx, (tx) =>
        interestEntriesRepo.list(tx, ctx, parsed.data.accountId?.toLowerCase()),
      );
      return InterestListDto.parse({ entries: rows.map(toInterestDto) });
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateInterestInput.safeParse(input);
      if (!parsed.success) throw zodProblem(parsed.error, input);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const data = parsed.data;
      const accountId = data.accountId.toLowerCase();
      const id = newId();
      const row = await run(ctx, async (tx) => {
        const account = await accountsRepo.find(tx, ctx, accountId);
        if (!account) throw invalid('accountId', 'not an account of this pool');
        if (account.type !== 'savings' && account.type !== 'term_deposit') {
          throw invalid('accountId', 'must be a savings or term-deposit account');
        }
        if (account.type === 'term_deposit') {
          const deposit = await depositsRepo.findByAccount(tx, ctx, accountId);
          if (deposit && isScheduled(toDomainDeposit(deposit))) {
            throw new ConflictError('This deposit pays on a schedule; its interest follows it.');
          }
        }
        return interestEntriesRepo.insert(tx, ctx, id, {
          accountId,
          date: data.date,
          amount: data.amount,
          note: data.note ?? null,
        });
      });
      await recordAudit(identity, ctx, 'interest.created', { target: id, ip: ipOf(headers) });
      return InterestEntryDto.parse(toInterestDto(row));
    },

    async remove(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const entryId = parseId(id);
      const removed = await run(ctx, (tx) => interestEntriesRepo.remove(tx, ctx, entryId));
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'interest.deleted', { target: entryId, ip: ipOf(headers) });
    },
  };
}
