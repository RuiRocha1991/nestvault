import {
  isUuid,
  newId,
  poolSettingsRepo,
  withPool,
  type IdentityDatabase,
  type PoolRunner,
} from '@nestvault/db';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { clientIpResolver } from '../rate-limit/client-ip';

import { loadFxRates } from './fx';
import {
  FxDto,
  FxQuery,
  SettingsDto,
  toFxDto,
  toSettingsDto,
  UpdateSettingsInput,
} from './schemas';

export interface SettingsService {
  /** The pool's settings, or the defaults while it never saved any (any member). */
  get(headers: Headers, poolId: string): Promise<SettingsDto>;
  /** Changes the settings (`settings.write`: owner and admin); fields left out stay. */
  update(headers: Headers, poolId: string, input: unknown): Promise<SettingsDto>;
  /** The EUR rate of every currency for this pool on a day (any member). */
  fx(headers: Headers, poolId: string, query?: unknown): Promise<FxDto>;
}

export interface SettingsServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  now?: () => Date;
}

export function createSettingsService(deps: SettingsServiceDeps): SettingsService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);
  const now = deps.now ?? (() => new Date());

  return {
    async get(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const row = await run(ctx, (tx) => poolSettingsRepo.find(tx, ctx));
      return SettingsDto.parse(toSettingsDto(row));
    },

    async update(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateSettingsInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'settings.write');

      const saved = await run(ctx, async (tx) => {
        const current = toSettingsDto(await poolSettingsRepo.find(tx, ctx));
        const row = await poolSettingsRepo.upsert(
          tx,
          ctx,
          newId(),
          {
            transferWindowDays: parsed.data.transferWindowDays ?? current.transferWindowDays,
            depositTax: parsed.data.depositTax ?? current.depositTax,
            dividendTax: parsed.data.dividendTax ?? current.dividendTax,
            displayCurrency: parsed.data.displayCurrency ?? current.displayCurrency,
            fxOverrides: parsed.data.fxOverrides ?? current.fxOverrides,
          },
          ctx.actor.kind === 'user' && isUuid(ctx.actor.userId) ? ctx.actor.userId : null,
        );
        return row;
      });
      // Values never reach the audit log: only that something changed and how many fields.
      await recordAudit(identity, ctx, 'settings.updated', {
        target: ctx.poolId,
        meta: { count: Object.keys(parsed.data).length },
        ip: ipOf(headers),
      });
      return SettingsDto.parse(toSettingsDto(saved));
    },

    async fx(headers, poolId, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = FxQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const asOf = parsed.data.asOf ?? now().toISOString().slice(0, 10);
      const rates = await run(ctx, (tx) => loadFxRates(tx, ctx, asOf));
      return FxDto.parse(toFxDto(asOf, rates));
    },
  };
}
