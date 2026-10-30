import {
  accountsRepo,
  goalsRepo,
  newId,
  portfoliosRepo,
  subAccountsRepo,
  withPool,
  type GoalRow,
  type GoalScopeValue,
  type GoalValues,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
} from '@nestvault/db';
import { goalCalc } from '@nestvault/domain';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { invalid, parseId, refOrRethrow } from '../investments/checks';
import { clientIpResolver } from '../rate-limit/client-ip';

import { loadGoalData, toDomainGoal } from './goal-data';
import {
  CreateGoalInput,
  GoalListDto,
  toGoalDto,
  UpdateGoalInput,
  type GoalAccountScope,
  type GoalDto,
} from './schemas';

export interface GoalsService {
  /** Goals of the pool with their calculation of today (any member). */
  list(headers: Headers, poolId: string): Promise<GoalListDto>;
  /** One goal (any member). */
  get(headers: Headers, poolId: string, id: string): Promise<GoalDto>;
  /** Creates a goal (`goals.write`). */
  create(headers: Headers, poolId: string, input: unknown): Promise<GoalDto>;
  /** Changes a goal; fields left out stay (`goals.write`). */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<GoalDto>;
  /** Deletes a goal and its scopes (`goals.write`). */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
}

export interface GoalsServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  now?: () => Date;
}

const scopeKey = (scope: GoalScopeValue) =>
  `${scope.portfolioId ?? ''}|${scope.accountId ?? ''}|${scope.subAccountId ?? ''}`;

/** The scopes of a request, in lower case and without repeats. */
function toScopes(
  portfolioIds: readonly string[],
  accounts: readonly GoalAccountScope[],
): GoalScopeValue[] {
  const scopes = new Map<string, GoalScopeValue>();
  for (const id of portfolioIds) {
    const scope = { portfolioId: id.toLowerCase(), accountId: null, subAccountId: null };
    scopes.set(scopeKey(scope), scope);
  }
  for (const item of accounts) {
    const scope = {
      portfolioId: null,
      accountId: item.accountId.toLowerCase(),
      subAccountId: item.subAccountId?.toLowerCase() ?? null,
    };
    scopes.set(scopeKey(scope), scope);
  }
  return [...scopes.values()];
}

/** Everything a goal counts must be the pool's own (the composite foreign keys repeat the rule). */
async function assertScopes(
  tx: PoolTx,
  ctx: PoolContext,
  scopes: readonly GoalScopeValue[],
): Promise<void> {
  for (const scope of scopes) {
    if (scope.portfolioId && !(await portfoliosRepo.find(tx, ctx, scope.portfolioId))) {
      throw invalid('portfolioIds', 'not a portfolio of this pool');
    }
    if (!scope.accountId) continue;
    if (!(await accountsRepo.find(tx, ctx, scope.accountId))) {
      throw invalid('accounts', 'not an account of this pool');
    }
    if (
      scope.subAccountId &&
      !(await subAccountsRepo.find(tx, ctx, scope.accountId, scope.subAccountId))
    ) {
      throw invalid('accounts', 'not a sub-account of this account');
    }
  }
}

/**
 * Rules that cross fields: a goal of type `contrib` always has a deadline (it is the year it counts),
 * and so does mode `date`.
 */
function normalize(values: GoalValues): GoalValues {
  const mode = values.type === 'contrib' ? 'date' : values.mode;
  if (mode === 'date' && !values.deadline) throw invalid('deadline', 'a deadline is needed');
  return { ...values, mode };
}

const toValues = (row: GoalRow): GoalValues => ({
  name: row.name,
  color: row.color,
  type: row.type,
  target: row.target,
  mode: row.mode,
  deadline: row.deadline,
  monthly: row.monthly,
  rate: row.rate,
  yield: row.yield,
  includeSavings: row.includeSavings,
});

export function createGoalsService(deps: GoalsServiceDeps): GoalsService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);
  const now = deps.now ?? (() => new Date());
  const today = () => now().toISOString().slice(0, 10);

  /** The goals as DTOs, calculated at `asOf` from one load of the pool's data. */
  async function view(tx: PoolTx, ctx: PoolContext, ids?: readonly string[]) {
    const asOf = today();
    const [rows, scopes, data] = await Promise.all([
      goalsRepo.list(tx, ctx),
      goalsRepo.listScopes(tx, ctx),
      loadGoalData(tx, ctx, asOf),
    ]);
    const goals = rows
      .filter((row) => !ids || ids.includes(row.id))
      .map((row) => {
        const own = scopes.filter((scope) => scope.goalId === row.id);
        return toGoalDto(row, own, goalCalc(toDomainGoal(row, own), data, asOf));
      });
    return GoalListDto.parse({ asOf, goals });
  }

  async function one(tx: PoolTx, ctx: PoolContext, id: string): Promise<GoalDto> {
    const found = (await view(tx, ctx, [id])).goals[0];
    if (!found) throw new NotFoundError();
    return found;
  }

  return {
    async list(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      return run(ctx, (tx) => view(tx, ctx));
    },

    async get(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const goalId = parseId(id);
      return run(ctx, (tx) => one(tx, ctx, goalId));
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateGoalInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'goals.write');
      const data = parsed.data;
      const id = newId();
      const values = normalize({
        name: data.name,
        color: data.color,
        type: data.type,
        target: data.target,
        mode: data.mode ?? 'date',
        deadline: data.deadline ?? null,
        monthly: data.monthly ?? null,
        rate: data.rate ?? null,
        yield: data.yield ?? null,
        includeSavings: data.includeSavings ?? false,
      });
      const scopes = toScopes(data.portfolioIds ?? [], data.accounts ?? []);
      const dto = await run(ctx, async (tx) => {
        await assertScopes(tx, ctx, scopes);
        await goalsRepo.insert(tx, ctx, id, values);
        await goalsRepo.replaceScopes(tx, ctx, id, scopes);
        return one(tx, ctx, id);
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'goal.created', { target: id, ip: ipOf(headers) });
      return dto;
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateGoalInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'goals.write');
      const goalId = parseId(id);
      const patch = parsed.data;
      const dto = await run(ctx, async (tx) => {
        const current = await goalsRepo.find(tx, ctx, goalId);
        if (!current) throw new NotFoundError();
        const base = toValues(current);
        const values = normalize({
          name: patch.name ?? base.name,
          color: patch.color ?? base.color,
          type: patch.type ?? base.type,
          target: patch.target ?? base.target,
          mode: patch.mode ?? base.mode,
          deadline: patch.deadline === undefined ? base.deadline : patch.deadline,
          monthly: patch.monthly === undefined ? base.monthly : patch.monthly,
          rate: patch.rate === undefined ? base.rate : patch.rate,
          yield: patch.yield === undefined ? base.yield : patch.yield,
          includeSavings: patch.includeSavings ?? base.includeSavings,
        });
        await goalsRepo.update(tx, ctx, goalId, values);
        if (patch.portfolioIds !== undefined || patch.accounts !== undefined) {
          const own = await goalsRepo.listScopes(tx, ctx, [goalId]);
          const scopes = toScopes(
            patch.portfolioIds ?? own.flatMap((s) => (s.portfolioId ? [s.portfolioId] : [])),
            patch.accounts ??
              own.flatMap((s) =>
                s.accountId ? [{ accountId: s.accountId, subAccountId: s.subAccountId }] : [],
              ),
          );
          await assertScopes(tx, ctx, scopes);
          await goalsRepo.replaceScopes(tx, ctx, goalId, scopes);
        }
        return one(tx, ctx, goalId);
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'goal.updated', { target: goalId, ip: ipOf(headers) });
      return dto;
    },

    async remove(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'goals.write');
      const goalId = parseId(id);
      const removed = await run(ctx, (tx) => goalsRepo.remove(tx, ctx, goalId));
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'goal.deleted', { target: goalId, ip: ipOf(headers) });
    },
  };
}
