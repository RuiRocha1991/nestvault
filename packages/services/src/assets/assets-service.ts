import {
  assetPricesRepo,
  assetsRepo,
  isUuid,
  newId,
  withPool,
  type AssetRow,
  type AssetValues,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
} from '@nestvault/db';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { isUniqueViolation } from '../db-errors';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { clientIpResolver } from '../rate-limit/client-ip';

import {
  AssetDto,
  AssetListDto,
  AssetsQuery,
  BulkPricesDto,
  BulkPricesInput,
  CreateAssetInput,
  PriceDto,
  PriceHistoryDto,
  PriceHistoryQuery,
  PriceInput,
  toAssetDto,
  toPriceDto,
  UpdateAssetInput,
} from './schemas';

export interface AssetsService {
  /** The pool's assets with the price on a day, today by default (any member). */
  list(headers: Headers, poolId: string, query?: unknown): Promise<AssetListDto>;
  /** One asset with its price on a day (any member). */
  get(headers: Headers, poolId: string, id: string, query?: unknown): Promise<AssetDto>;
  /** Defines an asset (`portfolios.write`); the ticker is unique inside the pool (409). */
  create(headers: Headers, poolId: string, input: unknown): Promise<AssetDto>;
  /** Changes an asset; fields left out stay (`portfolios.write`). */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<AssetDto>;
  /** Deletes an asset and its prices; 409 while operations use it (`portfolios.write`). */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
  /** The price history of an asset, newest first (any member). */
  prices(headers: Headers, poolId: string, id: string, query?: unknown): Promise<PriceHistoryDto>;
  /** Adds the price of a day or replaces it (`prices.write`). */
  setPrice(headers: Headers, poolId: string, id: string, input: unknown): Promise<PriceDto>;
  /** Removes the price of a day (`prices.write`). */
  removePrice(headers: Headers, poolId: string, id: string, date: string): Promise<void>;
  /** Many prices by ticker in one transaction: one invalid entry rejects them all (`prices.write`). */
  bulkPrices(headers: Headers, poolId: string, input: unknown): Promise<BulkPricesDto>;
}

export interface AssetsServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  now?: () => Date;
}

const invalid = (path: string, message: string) =>
  new ValidationError('The request is not valid.', [{ path, message }]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function createAssetsService(deps: AssetsServiceDeps): AssetsService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);
  const now = deps.now ?? (() => new Date());
  const today = () => now().toISOString().slice(0, 10);

  const parseId = (id: string) => {
    if (!isUuid(id)) throw new NotFoundError();
    return id.toLowerCase();
  };

  /** Prices come from the past or today: a price for a day that has not come is a typo. */
  const assertNotFuture = (date: string, path: string) => {
    if (date > today()) throw invalid(path, 'a price cannot be dated in the future');
  };

  async function read(
    tx: PoolTx,
    ctx: PoolContext,
    asOf: string,
    only?: string,
  ): Promise<AssetDto[]> {
    const rows = only
      ? [await assetsRepo.find(tx, ctx, only)].filter((row): row is AssetRow => !!row)
      : await assetsRepo.list(tx, ctx);
    const latest = new Map(
      (await assetPricesRepo.latestAsOf(tx, ctx, asOf)).map((price) => [price.assetId, price]),
    );
    return rows.map((row) => toAssetDto(row, latest.get(row.id)));
  }

  const uniqueTicker = (error: unknown): never => {
    if (isUniqueViolation(error)) throw new ConflictError('An asset with this ticker exists.');
    throw error;
  };

  return {
    async list(headers, poolId, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = AssetsQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const asOf = parsed.data.asOf ?? today();
      return AssetListDto.parse({ assets: await run(ctx, (tx) => read(tx, ctx, asOf)) });
    },

    async get(headers, poolId, id, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = AssetsQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const assetId = parseId(id);
      const asOf = parsed.data.asOf ?? today();
      const [found] = await run(ctx, (tx) => read(tx, ctx, asOf, assetId));
      if (!found) throw new NotFoundError();
      return AssetDto.parse(found);
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateAssetInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'portfolios.write');
      const data = parsed.data;
      const id = newId();
      try {
        await run(ctx, (tx) =>
          assetsRepo.insert(tx, ctx, id, {
            ticker: data.ticker,
            symbol: data.symbol ?? null,
            name: data.name,
            type: data.type,
            currency: data.currency,
            sector: data.sector ?? null,
            region: data.region ?? null,
            dps: data.dps ?? null,
            divMonths: data.divMonths ?? [],
          }),
        );
      } catch (error) {
        uniqueTicker(error);
      }
      await recordAudit(identity, ctx, 'asset.created', { target: id, ip: ipOf(headers) });
      const [created] = await run(ctx, (tx) => read(tx, ctx, today(), id));
      if (!created) throw new NotFoundError();
      return AssetDto.parse(created);
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateAssetInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'portfolios.write');
      const assetId = parseId(id);
      const data = parsed.data;
      try {
        await run(ctx, async (tx) => {
          const current = await assetsRepo.find(tx, ctx, assetId);
          if (!current) throw new NotFoundError();
          const values: AssetValues = {
            ticker: data.ticker ?? current.ticker,
            symbol: data.symbol === undefined ? current.symbol : data.symbol,
            name: data.name ?? current.name,
            type: data.type ?? current.type,
            currency: data.currency ?? current.currency,
            sector: data.sector === undefined ? current.sector : data.sector,
            region: data.region === undefined ? current.region : data.region,
            dps: data.dps === undefined ? current.dps : data.dps,
            divMonths: data.divMonths ?? current.divMonths,
          };
          await assetsRepo.update(tx, ctx, assetId, values);
        });
      } catch (error) {
        uniqueTicker(error);
      }
      await recordAudit(identity, ctx, 'asset.updated', { target: assetId, ip: ipOf(headers) });
      const [updated] = await run(ctx, (tx) => read(tx, ctx, today(), assetId));
      if (!updated) throw new NotFoundError();
      return AssetDto.parse(updated);
    },

    async remove(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'portfolios.write');
      const assetId = parseId(id);
      await run(ctx, async (tx) => {
        if (!(await assetsRepo.find(tx, ctx, assetId))) throw new NotFoundError();
        if ((await assetsRepo.countReferences(tx, ctx, assetId)) > 0) {
          throw new ConflictError('This asset has operations. Remove them first.');
        }
        await assetsRepo.remove(tx, ctx, assetId);
      });
      await recordAudit(identity, ctx, 'asset.deleted', { target: assetId, ip: ipOf(headers) });
    },

    async prices(headers, poolId, id, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = PriceHistoryQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const assetId = parseId(id);
      const rows = await run(ctx, async (tx) => {
        if (!(await assetsRepo.find(tx, ctx, assetId))) throw new NotFoundError();
        return assetPricesRepo.history(tx, ctx, assetId, {
          ...(parsed.data.from ? { from: parsed.data.from } : {}),
          ...(parsed.data.to ? { to: parsed.data.to } : {}),
          limit: parsed.data.limit ?? 1000,
        });
      });
      return PriceHistoryDto.parse({ prices: rows.map(toPriceDto) });
    },

    async setPrice(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = PriceInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'prices.write');
      const assetId = parseId(id);
      assertNotFuture(parsed.data.date, 'date');
      const saved = await run(ctx, async (tx) => {
        if (!(await assetsRepo.find(tx, ctx, assetId))) throw new NotFoundError();
        await assetPricesRepo.upsertMany(
          tx,
          ctx,
          [{ assetId, date: parsed.data.date, price: parsed.data.price }],
          'manual',
        );
        const [row] = await assetPricesRepo.history(tx, ctx, assetId, {
          from: parsed.data.date,
          to: parsed.data.date,
          limit: 1,
        });
        return row;
      });
      if (!saved) throw new NotFoundError();
      await recordAudit(identity, ctx, 'asset.price_set', { target: assetId, ip: ipOf(headers) });
      return PriceDto.parse(toPriceDto(saved));
    },

    async removePrice(headers, poolId, id, date) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'prices.write');
      const assetId = parseId(id);
      if (!ISO_DATE.test(date)) throw new NotFoundError();
      await run(ctx, async (tx) => {
        if (!(await assetPricesRepo.remove(tx, ctx, assetId, date))) throw new NotFoundError();
      });
      await recordAudit(identity, ctx, 'asset.price_deleted', { target: assetId, ip: ipOf(headers) });
    },

    async bulkPrices(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = BulkPricesInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'prices.write');
      parsed.data.prices.forEach((entry, index) => {
        assertNotFuture(entry.date, `prices.${index}.date`);
      });
      const updated = await run(ctx, async (tx) => {
        const byTicker = new Map(
          (await assetsRepo.list(tx, ctx)).map((row) => [row.ticker, row.id]),
        );
        // Validate every entry before writing any: one unknown ticker rejects the whole batch.
        const latest = new Map<string, { assetId: string; date: string; price: string }>();
        parsed.data.prices.forEach((entry, index) => {
          const assetId = byTicker.get(entry.ticker);
          if (!assetId) throw invalid(`prices.${index}.ticker`, 'unknown ticker');
          // The last entry for the same asset and day wins.
          latest.set(`${assetId}|${entry.date}`, { assetId, date: entry.date, price: entry.price });
        });
        const values = [...latest.values()];
        await assetPricesRepo.upsertMany(tx, ctx, values, 'bulk');
        return values.length;
      });
      await recordAudit(identity, ctx, 'asset.prices_imported', {
        target: ctx.poolId,
        meta: { count: updated },
        ip: ipOf(headers),
      });
      return BulkPricesDto.parse({ updated });
    },
  };
}
