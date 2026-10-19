import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AssetDto,
  BULK_PRICES_MAX,
  ConflictError,
  ForbiddenError,
  logger,
  NotFoundError,
  PriceDto,
  UnauthorizedError,
  ValidationError,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { rows } from '../support/auth-harness';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;

beforeAll(async () => {
  logger.level = 'silent';
  world = await createApiWorld();
});

beforeEach(async () => {
  s = await world.newScenario();
});

afterAll(async () => {
  await world.close();
});

const create = async (as: Persona, body: unknown, poolId = s.poolA) =>
  world.assets.create(await s.as(as), poolId, body);
const list = async (as: Persona, query?: unknown, poolId = s.poolA) =>
  (await world.assets.list(await s.as(as), poolId, query)).assets;
const setPrice = async (as: Persona, id: string, body: unknown, poolId = s.poolA) =>
  world.assets.setPrice(await s.as(as), poolId, id, body);
const prices = async (as: Persona, id: string, query?: unknown, poolId = s.poolA) =>
  (await world.assets.prices(await s.as(as), poolId, id, query)).prices;
const bulk = async (as: Persona, body: unknown, poolId = s.poolA) =>
  world.assets.bulkPrices(await s.as(as), poolId, body);

const etf = (extra: Record<string, unknown> = {}) => ({
  ticker: 'vwce',
  name: 'Vanguard FTSE All-World',
  type: 'etf',
  currency: 'EUR',
  ...extra,
});

describe('assets service: defining assets', () => {
  it('lets owner and admin define an asset, normalizing the ticker, and refuses member and viewer', async () => {
    const created = await create('owner', etf({ dps: '1.5', divMonths: [12, 3, 3, 6, 9] }));
    expect(AssetDto.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      ticker: 'VWCE',
      dps: '1.5',
      divMonths: [3, 6, 9, 12],
      price: null,
      priceDate: null,
    });
    await create('admin', etf({ ticker: 'AAPL', currency: 'USD', type: 'stock' }));
    for (const persona of ['member', 'viewer'] as const) {
      await expect(create(persona, etf({ ticker: 'X1' }))).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(create('outsider', etf())).rejects.toBeInstanceOf(NotFoundError);
    expect((await list('viewer')).map((asset) => asset.ticker)).toEqual(['AAPL', 'VWCE']);
  });

  it('rejects a duplicate ticker in the same pool (409) and allows it in another pool', async () => {
    await create('owner', etf());
    await expect(create('owner', etf({ ticker: 'VWCE', name: 'dup' }))).rejects.toBeInstanceOf(
      ConflictError,
    );
    const other = await create('outsider', etf(), s.poolB);
    expect(other.ticker).toBe('VWCE');
    expect(await list('owner')).toHaveLength(1);
  });

  it.each([
    ['a ticker with a space', { ticker: 'A B' }],
    ['a ticker with a quote', { ticker: "A'; --" }],
    ['an empty name', { name: '  ' }],
    ['an unknown type', { type: 'nft' }],
    ['a currency outside the list', { currency: 'JPY' }],
    ['a dividend that is not a decimal', { dps: '1,5' }],
    ['a negative dividend', { dps: '-1' }],
    ['a month 13', { divMonths: [13] }],
    ['a month 0', { divMonths: [0] }],
    ['an unknown field', { poolId: '0192f3a1-0000-7000-8000-000000000001' }],
    ['the id', { id: '0192f3a1-0000-7000-8000-000000000001' }],
  ])('rejects %s with 400', async (_name, patch) => {
    await expect(create('owner', etf(patch))).rejects.toBeInstanceOf(ValidationError);
    expect(await list('owner')).toEqual([]);
  });

  it('stores injection payloads in text fields literally', async () => {
    const payload = "'; DROP TABLE assets; --";
    const created = await create(
      'owner',
      etf({ name: "' OR 1=1 --", symbol: payload, sector: payload, region: payload }),
    );
    expect(created).toMatchObject({ name: "' OR 1=1 --", symbol: payload });
    expect(await list('owner')).toHaveLength(1);
  });

  it('changes some fields and keeps the others, and refuses a ticker already in use', async () => {
    const first = await create('owner', etf({ dps: '2', region: 'World' }));
    await create('owner', etf({ ticker: 'AAPL', type: 'stock', currency: 'USD' }));
    const changed = await world.assets.update(await s.as('admin'), s.poolA, first.id, {
      name: 'Novo nome',
      region: null,
    });
    expect(changed).toMatchObject({ name: 'Novo nome', region: null, dps: '2', ticker: 'VWCE' });
    await expect(
      world.assets.update(await s.as('owner'), s.poolA, first.id, { ticker: 'aapl' }),
    ).rejects.toBeInstanceOf(ConflictError);
    for (const persona of ['member', 'viewer'] as const) {
      await expect(
        world.assets.update(await s.as(persona), s.poolA, first.id, { name: 'x' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(
      world.assets.update(await s.as('owner'), s.poolA, first.id, { poolId: 'x' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('deletes an asset with its prices, and never touches another pool’s asset', async () => {
    const mine = await create('owner', etf());
    await setPrice('owner', mine.id, { date: '2026-01-02', price: '10' });
    const theirs = await create('outsider', etf({ ticker: 'THEIRS' }), s.poolB);
    await expect(
      world.assets.remove(await s.as('owner'), s.poolA, theirs.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.assets.remove(await s.as('member'), s.poolA, mine.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await world.assets.remove(await s.as('admin'), s.poolA, mine.id);
    expect(await list('owner')).toEqual([]);
    expect(await list('outsider', undefined, s.poolB)).toHaveLength(1);
    const left = await world.database.asMigrator(
      async (pool) =>
        (await pool.query<{ asset_id: string }>('select asset_id from asset_prices')).rows,
    );
    expect(left).toEqual([]);
  });

  it('hides the pool from a non-member and refuses a request without a session', async () => {
    await expect(world.assets.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(list('outsider')).rejects.toBeInstanceOf(NotFoundError);
    const mine = await create('owner', etf());
    await expect(world.assets.get(await s.as('outsider'), s.poolB, mine.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.assets.get(await s.as('viewer'), s.poolA, 'not-a-uuid'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('writes audit entries that name only the id', async () => {
    const created = await create('owner', etf({ name: 'Segredo SA' }));
    await setPrice('owner', created.id, { date: '2026-01-02', price: '123.456' });
    const entries = await rows<{ action: string; target: string }>(
      world.identity,
      sql`select action, target from audit_log where action like 'asset.%' and target = ${created.id} order by at`,
    );
    expect(entries.map((entry) => entry.action)).toEqual(['asset.created', 'asset.price_set']);
    expect(JSON.stringify(entries)).not.toMatch(/Segredo|123\.456/);
  });
});

describe('assets service: prices', () => {
  it('adds a price, replaces the one of the same day and shows the newest on or before a day', async () => {
    const asset = await create('owner', etf());
    expect(
      PriceDto.parse(await setPrice('owner', asset.id, { date: '2026-01-10', price: '100' })),
    ).toEqual({
      date: '2026-01-10',
      price: '100',
      source: 'manual',
    });
    await setPrice('owner', asset.id, { date: '2026-03-10', price: '120.5' });
    const replaced = await setPrice('member', asset.id, { date: '2026-03-10', price: '121.25' });
    expect(replaced.price).toBe('121.25');

    expect((await prices('viewer', asset.id)).map((p) => [p.date, p.price])).toEqual([
      ['2026-03-10', '121.25'],
      ['2026-01-10', '100'],
    ]);
    const as = async (asOf: string) => (await list('viewer', { asOf }))[0];
    expect(await as('2026-02-01')).toMatchObject({ price: '100', priceDate: '2026-01-10' });
    expect(await as('2026-12-31')).toMatchObject({ price: '121.25', priceDate: '2026-03-10' });
    expect(await as('2025-12-31')).toMatchObject({ price: null, priceDate: null });
    expect((await prices('viewer', asset.id, { from: '2026-02-01' })).map((p) => p.date)).toEqual([
      '2026-03-10',
    ]);
  });

  it('changes the value for everyone who holds the asset: one price, read by every member', async () => {
    const asset = await create('owner', etf());
    await setPrice('owner', asset.id, { date: '2026-01-10', price: '100' });
    await setPrice('member', asset.id, { date: '2026-01-11', price: '90' });
    for (const persona of ['owner', 'admin', 'member', 'viewer'] as const) {
      expect((await list(persona, { asOf: '2026-02-01' }))[0]?.price).toBe('90');
    }
  });

  it('lets member update prices and refuses viewer (403) and a non-member (404)', async () => {
    const asset = await create('owner', etf());
    await setPrice('member', asset.id, { date: '2026-01-10', price: '1' });
    await expect(
      setPrice('viewer', asset.id, { date: '2026-01-10', price: '2' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setPrice('outsider', asset.id, { date: '2026-01-10', price: '2' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.assets.removePrice(await s.as('viewer'), s.poolA, asset.id, '2026-01-10'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await world.assets.removePrice(await s.as('member'), s.poolA, asset.id, '2026-01-10');
    expect(await prices('owner', asset.id)).toEqual([]);
    await expect(
      world.assets.removePrice(await s.as('member'), s.poolA, asset.id, '2026-01-10'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each([
    ['a price of zero', { date: '2026-01-10', price: '0' }],
    ['a negative price', { date: '2026-01-10', price: '-1' }],
    ['a price with 7 decimals', { date: '2026-01-10', price: '1.1234567' }],
    ['a price as a number', { date: '2026-01-10', price: 1.5 }],
    ['a price with a comma', { date: '2026-01-10', price: '1,5' }],
    ['a malformed date', { date: '10/01/2026', price: '1' }],
    ['a future date', { date: '2999-01-01', price: '1' }],
    ['an unknown field', { date: '2026-01-10', price: '1', source: 'provider' }],
  ])('rejects %s with 400', async (_name, body) => {
    const asset = await create('owner', etf());
    await expect(setPrice('owner', asset.id, body)).rejects.toBeInstanceOf(ValidationError);
    expect(await prices('owner', asset.id)).toEqual([]);
  });

  it('never reads or writes the prices of another pool’s asset', async () => {
    const theirs = await create('outsider', etf({ ticker: 'THEIRS' }), s.poolB);
    await setPrice('outsider', theirs.id, { date: '2026-01-10', price: '5' }, s.poolB);
    await expect(prices('owner', theirs.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setPrice('owner', theirs.id, { date: '2026-01-11', price: '6' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.assets.removePrice(await s.as('owner'), s.poolA, theirs.id, '2026-01-10'),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await prices('outsider', theirs.id, undefined, s.poolB)).toHaveLength(1);
  });
});

describe('assets service: bulk price update', () => {
  it('stores N prices by ticker in one go, the last duplicate winning, and audits the count', async () => {
    const a = await create('owner', etf());
    const b = await create('owner', etf({ ticker: 'AAPL', type: 'stock', currency: 'USD' }));
    const result = await bulk('member', {
      prices: [
        { ticker: 'vwce', date: '2026-01-10', price: '100' },
        { ticker: 'AAPL', date: '2026-01-10', price: '200' },
        { ticker: 'VWCE', date: '2026-01-10', price: '101' },
        { ticker: 'VWCE', date: '2026-01-11', price: '102' },
      ],
    });
    expect(result).toEqual({ updated: 3 });
    expect((await prices('viewer', a.id)).map((p) => [p.date, p.price, p.source])).toEqual([
      ['2026-01-11', '102', 'bulk'],
      ['2026-01-10', '101', 'bulk'],
    ]);
    expect((await prices('viewer', b.id))[0]?.price).toBe('200');
    const entries = await rows<{ meta: { count: number } }>(
      world.identity,
      sql`select meta from audit_log where action = 'asset.prices_imported' and target = ${s.poolA}`,
    );
    expect(entries[0]?.meta).toEqual({ count: 3 });
  });

  it('rejects the whole batch when one entry is invalid: nothing is stored', async () => {
    const a = await create('owner', etf());
    const bad: unknown[] = [
      {
        prices: [
          { ticker: 'VWCE', date: '2026-01-10', price: '100' },
          { ticker: 'NOPE', date: '2026-01-10', price: '1' },
        ],
      },
      {
        prices: [
          { ticker: 'VWCE', date: '2026-01-10', price: '100' },
          { ticker: 'VWCE', date: '2026-01-11', price: '0' },
        ],
      },
      {
        prices: [
          { ticker: 'VWCE', date: '2026-01-10', price: '100' },
          { ticker: 'VWCE', date: '2999-01-01', price: '1' },
        ],
      },
      {
        prices: [
          { ticker: 'VWCE', date: '2026-01-10', price: '100' },
          { ticker: 'VWCE', date: '2026-01-12' },
        ],
      },
      { prices: [] },
      {
        prices: Array.from({ length: BULK_PRICES_MAX + 1 }, () => ({
          ticker: 'VWCE',
          date: '2026-01-10',
          price: '1',
        })),
      },
      { prices: [{ ticker: 'VWCE', date: '2026-01-10', price: '1' }], poolId: s.poolB },
    ];
    for (const body of bad) {
      await expect(bulk('owner', body)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await prices('owner', a.id)).toEqual([]);
  });

  it('resolves tickers inside the pool only, refuses viewer (403) and non-member (404)', async () => {
    await create('owner', etf());
    await create('outsider', etf({ ticker: 'THEIRS' }), s.poolB);
    await expect(
      bulk('owner', { prices: [{ ticker: 'THEIRS', date: '2026-01-10', price: '1' }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    const body = { prices: [{ ticker: 'VWCE', date: '2026-01-10', price: '1' }] };
    await expect(bulk('viewer', body)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(bulk('outsider', body)).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.assets.bulkPrices(new Headers(), s.poolA, body)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
