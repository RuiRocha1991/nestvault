import {
  accountsRepo,
  categoriesRepo,
  categoryRulesRepo,
  isUuid,
  newId,
  transactionsRepo,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
} from '@nestvault/db';
import { previewRules } from '@nestvault/domain';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { clientIpResolver } from '../rate-limit/client-ip';
import { loadEngineContext, toEngineTransaction } from '../transactions/engine';

import {
  ApplyRulesDto,
  ApplyRulesInput,
  CreateRuleInput,
  PREVIEW_SAMPLE_MAX,
  ReorderRulesInput,
  RuleDto,
  RuleListDto,
  RULES_MAX,
  toRuleDto,
  UpdateRuleInput,
} from './schemas';

export interface RulesService {
  /** The pool's keyword rules in the order they are tried (any member). */
  list(headers: Headers, poolId: string): Promise<RuleListDto>;
  /** Adds a rule after the last (`categories.write`); its category is global or the pool's own. */
  create(headers: Headers, poolId: string, input: unknown): Promise<RuleDto>;
  /** Changes a rule; fields left out stay (`categories.write`). */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<RuleDto>;
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
  /** Puts the rules in the given order (`categories.write`); `ids` must be all of them. */
  reorder(headers: Headers, poolId: string, input: unknown): Promise<RuleListDto>;
  /** Previews (`confirm: false`) or applies (`true`) the rules to the existing movements. */
  apply(headers: Headers, poolId: string, input: unknown): Promise<ApplyRulesDto>;
}

export interface RulesServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
}

const invalid = (path: string, message: string) =>
  new ValidationError('The request is not valid.', [{ path, message }]);

export function createRulesService(deps: RulesServiceDeps): RulesService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

  const parseId = (id: string) => {
    if (!isUuid(id)) throw new NotFoundError();
    return id.toLowerCase();
  };

  /** A rule sends to a category of this pool or a global one, and to an account of this pool. */
  async function assertTargets(
    tx: PoolTx,
    ctx: PoolContext,
    categoryId: string,
    accountId: string | null,
  ) {
    if (!(await categoriesRepo.find(tx, ctx, categoryId))) {
      throw invalid('categoryId', 'not a category of this pool');
    }
    if (accountId && !(await accountsRepo.find(tx, ctx, accountId))) {
      throw invalid('accountId', 'not an account of this pool');
    }
  }

  return {
    async list(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const rows = await run(ctx, (tx) => categoryRulesRepo.list(tx, ctx));
      return RuleListDto.parse({ rules: rows.map(toRuleDto) });
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateRuleInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'categories.write');
      const categoryId = parsed.data.categoryId.toLowerCase();
      const accountId = parsed.data.accountId?.toLowerCase() ?? null;
      const id = newId();
      const created = await run(ctx, async (tx) => {
        if ((await categoryRulesRepo.list(tx, ctx)).length >= RULES_MAX) {
          throw invalid('keyword', 'too many rules');
        }
        await assertTargets(tx, ctx, categoryId, accountId);
        return categoryRulesRepo.insert(tx, ctx, id, {
          keyword: parsed.data.keyword,
          categoryId,
          accountId,
        });
      });
      await recordAudit(identity, ctx, 'rule.created', { target: id, ip: ipOf(headers) });
      return RuleDto.parse(toRuleDto(created));
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateRuleInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'categories.write');
      const ruleId = parseId(id);
      const updated = await run(ctx, async (tx) => {
        const current = await categoryRulesRepo.find(tx, ctx, ruleId);
        if (!current) throw new NotFoundError();
        const categoryId = parsed.data.categoryId?.toLowerCase() ?? current.categoryId;
        const accountId =
          parsed.data.accountId === undefined
            ? current.accountId
            : (parsed.data.accountId?.toLowerCase() ?? null);
        await assertTargets(tx, ctx, categoryId, accountId);
        return categoryRulesRepo.update(tx, ctx, ruleId, {
          keyword: parsed.data.keyword ?? current.keyword,
          categoryId,
          accountId,
        });
      });
      if (!updated) throw new NotFoundError();
      await recordAudit(identity, ctx, 'rule.updated', { target: ruleId, ip: ipOf(headers) });
      return RuleDto.parse(toRuleDto(updated));
    },

    async remove(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'categories.write');
      const ruleId = parseId(id);
      await run(ctx, async (tx) => {
        if (!(await categoryRulesRepo.remove(tx, ctx, ruleId))) throw new NotFoundError();
      });
      await recordAudit(identity, ctx, 'rule.deleted', { target: ruleId, ip: ipOf(headers) });
    },

    async reorder(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = ReorderRulesInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'categories.write');
      const ids = parsed.data.ids.map((id) => id.toLowerCase());
      const rows = await run(ctx, async (tx) => {
        const current = await categoryRulesRepo.list(tx, ctx);
        const known = new Set(current.map((rule) => rule.id));
        // Exactly the pool's rules, each once: nothing added, nothing left out.
        if (
          ids.length !== known.size ||
          new Set(ids).size !== ids.length ||
          !ids.every((id) => known.has(id))
        ) {
          throw invalid('ids', 'must list every rule of the pool once');
        }
        await categoryRulesRepo.reorder(tx, ctx, ids);
        return categoryRulesRepo.list(tx, ctx);
      });
      await recordAudit(identity, ctx, 'rule.reordered', {
        target: ctx.poolId,
        meta: { count: ids.length },
        ip: ipOf(headers),
      });
      return RuleListDto.parse({ rules: rows.map(toRuleDto) });
    },

    async apply(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = ApplyRulesInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'categories.write');
      const result = await run(ctx, async (tx) => {
        const [engine, stored] = await Promise.all([
          loadEngineContext(tx, ctx),
          transactionsRepo.listForEngine(tx, ctx),
        ]);
        const byId = new Map(stored.map((row) => [row.id, row]));
        // A category chosen by hand is never overridden: `force` stays off.
        const matches = previewRules(stored.map(toEngineTransaction), engine.rules);
        const changes = matches.filter((match) => match.changed);
        if (parsed.data.confirm) {
          await transactionsRepo.applyChanges(
            tx,
            ctx,
            changes.map((change) => ({
              id: change.transactionId,
              categoryId: change.result.categoryId,
              transfer: change.result.transfer,
            })),
          );
        }
        return {
          matched: matches.length,
          changed: changes.length,
          applied: parsed.data.confirm,
          changes: changes.slice(0, PREVIEW_SAMPLE_MAX).map((change) => ({
            transactionId: change.transactionId,
            description: byId.get(change.transactionId)?.description ?? '',
            fromCategoryId: change.fromCategoryId,
            toCategoryId: change.result.categoryId,
            transfer: change.result.transfer,
          })),
        };
      });
      if (parsed.data.confirm) {
        await recordAudit(identity, ctx, 'rule.applied', {
          target: ctx.poolId,
          meta: { count: result.changed },
          ip: ipOf(headers),
        });
      }
      return ApplyRulesDto.parse(result);
    },
  };
}
