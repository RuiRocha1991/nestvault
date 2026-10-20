import {
  holdersRepo,
  isUuid,
  newId,
  poolMembersRepo,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolTx,
  type PoolRunner,
} from '@nestvault/db';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { clientIpResolver } from '../rate-limit/client-ip';

import { nextHolderColor } from './palette';
import {
  CreateHolderInput,
  HolderDto,
  HolderListDto,
  HOLDER_ALIASES_MAX,
  MergeHolderInput,
  MergePreviewDto,
  toHolderDto,
  UpdateHolderInput,
} from './schemas';
import { ensureMemberHolders } from './sync-members';

export interface HoldersService {
  /** The people of the household (any member): every member of the pool plus those added by hand. */
  list(headers: Headers, poolId: string): Promise<HolderListDto>;
  /** Adds a person (`accounts.write`). */
  create(headers: Headers, poolId: string, input: unknown): Promise<HolderDto>;
  /** Changes a person (`accounts.write`); fields left out stay. */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<HolderDto>;
  /** Removes a person (`accounts.write`); 409 for a current member and while accounts name them. */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
  /** What merging `id` into `query.intoId` would move (`accounts.write`); changes nothing. */
  mergePreview(
    headers: Headers,
    poolId: string,
    id: string,
    query: unknown,
  ): Promise<MergePreviewDto>;
  /**
   * Joins a person added by hand (`id`) into another one (`accounts.write`): in one transaction
   * every account, sub-account and alias moves to the target, then the source is deleted. The
   * target keeps its name. Answers the target; 409 for a member's holder or more than 10 aliases.
   */
  merge(headers: Headers, poolId: string, id: string, input: unknown): Promise<HolderDto>;
}

export interface HoldersServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  now?: () => Date;
}

const UNIQUE_VIOLATION = '23505';

/** Drizzle wraps the driver error: the Postgres code is on `cause`. */
function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === UNIQUE_VIOLATION
  );
}

export function createHoldersService(deps: HoldersServiceDeps): HoldersService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);
  const now = deps.now ?? (() => new Date());
  const sync = (ctx: PoolContext) => ensureMemberHolders({ identity, run, now }, ctx);

  const parseId = (id: string) => {
    if (!isUuid(id)) throw new NotFoundError();
    return id.toLowerCase();
  };

  /** The identity database holds the membership: a holder only links to a member of this pool. */
  async function assertMember(poolId: string, userId: string | null | undefined) {
    if (!userId) return;
    const membership = await poolMembersRepo.findRole(identity.db, poolId, userId.toLowerCase());
    if (membership === null) {
      throw new ValidationError('The request is not valid.', [
        { path: 'userId', message: 'not a member of this pool' },
      ]);
    }
  }

  /** Locks both people (so a double click queues up) and works out the aliases the target ends with. */
  async function loadMerge(
    tx: PoolTx,
    ctx: PoolContext,
    fromId: string,
    intoId: string,
    memberIds: ReadonlySet<string>,
  ) {
    if (fromId === intoId) {
      throw new ValidationError('The request is not valid.', [
        { path: 'intoId', message: 'must be another person' },
      ]);
    }
    // Locked in id order, so two opposite merges cannot wait on each other.
    const [firstId, secondId] = fromId < intoId ? [fromId, intoId] : [intoId, fromId];
    const first = await holdersRepo.findForUpdate(tx, ctx, firstId);
    const second = await holdersRepo.findForUpdate(tx, ctx, secondId);
    const from = fromId === firstId ? first : second;
    const into = fromId === firstId ? second : first;
    if (!from || !into) throw new NotFoundError();
    if (from.userId !== null && memberIds.has(from.userId)) {
      throw new ConflictError('This person is a member of the pool and cannot be merged away.');
    }
    const addedAliases = from.aliases.filter((alias) => !into.aliases.includes(alias));
    return { addedAliases, aliases: [...into.aliases, ...addedAliases] };
  }

  return {
    async list(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const memberIds = await sync(ctx);
      const rows = await run(ctx, (tx) => holdersRepo.list(tx, ctx));
      return HolderListDto.parse({ holders: rows.map((row) => toHolderDto(row, memberIds)) });
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateHolderInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const userId = parsed.data.userId?.toLowerCase() ?? null;
      await assertMember(ctx.poolId, userId);
      const memberIds = await sync(ctx);

      const id = newId();
      try {
        await run(ctx, async (tx) => {
          const existing = await holdersRepo.list(tx, ctx);
          await holdersRepo.insert(tx, ctx, id, {
            name: parsed.data.name,
            color: parsed.data.color ?? nextHolderColor(existing.map((row) => row.color)),
            aliases: parsed.data.aliases ?? [],
            userId,
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictError('This member is already a person.');
        throw error;
      }
      await recordAudit(identity, ctx, 'holder.created', { target: id, ip: ipOf(headers) });
      const created = await run(ctx, (tx) => holdersRepo.find(tx, ctx, id));
      if (!created) throw new NotFoundError();
      return HolderDto.parse(toHolderDto(created, memberIds));
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateHolderInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const holderId = parseId(id);
      if (parsed.data.userId) await assertMember(ctx.poolId, parsed.data.userId);
      const memberIds = await sync(ctx);

      let updated;
      try {
        updated = await run(ctx, async (tx) => {
          const current = await holdersRepo.find(tx, ctx, holderId);
          if (!current) throw new NotFoundError();
          return holdersRepo.update(tx, ctx, holderId, {
            name: parsed.data.name ?? current.name,
            color: parsed.data.color ?? current.color,
            aliases: parsed.data.aliases ?? current.aliases,
            userId:
              parsed.data.userId === undefined
                ? current.userId
                : (parsed.data.userId?.toLowerCase() ?? null),
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictError('This member is already a person.');
        throw error;
      }
      if (!updated) throw new NotFoundError();
      await recordAudit(identity, ctx, 'holder.updated', { target: holderId, ip: ipOf(headers) });
      return HolderDto.parse(toHolderDto(updated, memberIds));
    },

    async remove(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const holderId = parseId(id);
      const memberIds = await sync(ctx);

      await run(ctx, async (tx) => {
        const current = await holdersRepo.find(tx, ctx, holderId);
        if (!current) throw new NotFoundError();
        // A member is always a person of the household: removing the holder would only bring it back.
        if (current.userId !== null && memberIds.has(current.userId)) {
          throw new ConflictError('This person is a member of the pool. Remove the member first.');
        }
        if ((await holdersRepo.countReferences(tx, ctx, holderId)) > 0) {
          throw new ConflictError('This person still has accounts. Move or remove them first.');
        }
        await holdersRepo.remove(tx, ctx, holderId);
      });
      await recordAudit(identity, ctx, 'holder.deleted', { target: holderId, ip: ipOf(headers) });
    },

    async mergePreview(headers, poolId, id, query) {
      const session = await requireSession(auth, headers);
      const parsed = MergeHolderInput.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const fromId = parseId(id);
      const memberIds = await sync(ctx);
      return run(ctx, async (tx) => {
        const plan = await loadMerge(tx, ctx, fromId, parsed.data.intoId.toLowerCase(), memberIds);
        const moves = await holdersRepo.countMoves(tx, ctx, fromId);
        return MergePreviewDto.parse({
          ...moves,
          addedAliases: plan.addedAliases,
          tooManyAliases: plan.aliases.length > HOLDER_ALIASES_MAX,
        });
      });
    },

    async merge(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = MergeHolderInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'accounts.write');
      const fromId = parseId(id);
      const intoId = parsed.data.intoId.toLowerCase();
      const memberIds = await sync(ctx);

      const merged = await run(ctx, async (tx) => {
        const plan = await loadMerge(tx, ctx, fromId, intoId, memberIds);
        if (plan.aliases.length > HOLDER_ALIASES_MAX) {
          throw new ConflictError('The merged person would have more than 10 aliases.');
        }
        await holdersRepo.merge(tx, ctx, fromId, intoId, plan.aliases);
        const row = await holdersRepo.find(tx, ctx, intoId);
        if (!row) throw new NotFoundError();
        return row;
      });
      await recordAudit(identity, ctx, 'holder.merged', { target: intoId, ip: ipOf(headers) });
      return HolderDto.parse(toHolderDto(merged, memberIds));
    },
  };
}
