import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { netWorthSnapshotsRepo } from '@nestvault/db';
import {
  createOverviewService,
  ForbiddenError,
  logger,
  pastMonthEnds,
  snapshotPool,
  systemContext,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Scenario } from '../support/api-world';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;

const TODAY = new Date('2026-10-21T12:00:00Z');
const TODAY_ISO = '2026-10-21';

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

const run = () => world.database.withPool;
const ctxOf = (poolId: string) => systemContext(poolId, ['pool.read', 'snapshots.write']);
const overview = async (poolId = s.poolA) =>
  createOverviewService({
    auth: world.auth,
    identity: world.identity,
    run: run(),
    now: () => TODAY,
  }).get(await s.as('owner'), poolId, { range: '12' });
const stored = (poolId: string, from = '2000-01-01', to = '2100-01-01') =>
  run()(ctxOf(poolId), (tx) => netWorthSnapshotsRepo.listBetween(tx, ctxOf(poolId), from, to));

/** Checking opened with 1 000 on 2026-01-01, movements in September and October, 2 units of VWCE. */
async function household(poolId = s.poolA) {
  const owner = await s.as('owner');
  const holder = (await world.holders.list(owner, poolId)).holders[0]?.id ?? '';
  const checking = await world.accounts.create(owner, poolId, {
    type: 'checking',
    name: 'Conta',
    currency: 'EUR',
    holderIds: [holder],
    opening: '1000',
    openingDate: '2026-01-01',
  });
  await world.transactions.create(owner, poolId, {
    accountId: checking.id,
    date: '2026-09-10',
    description: 'Compras',
    amount: '-200',
  });
  await world.transactions.create(owner, poolId, {
    accountId: checking.id,
    date: '2026-10-02',
    description: 'Salario',
    amount: '1500',
  });
  const portfolio = await world.portfolios.create(owner, poolId, {
    name: 'Longo prazo',
    color: '#9D6BFF',
    currency: 'EUR',
  });
  const asset = await world.assets.create(owner, poolId, {
    ticker: 'VWCE',
    name: 'Vanguard FTSE All-World',
    type: 'etf',
    currency: 'EUR',
  });
  await world.assets.setPrice(owner, poolId, asset.id, { date: '2026-10-20', price: '100' });
  await world.ops.create(owner, poolId, {
    portfolioId: portfolio.id,
    assetId: asset.id,
    type: 'buy',
    date: '2026-03-10',
    qty: '2',
    price: '80',
  });
}

describe('pastMonthEnds', () => {
  it('lists the month ends from the first record up to the month before today', () => {
    expect(pastMonthEnds('2026-07-15', '2026-10-21')).toEqual([
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
    ]);
    expect(pastMonthEnds('2026-10-01', '2026-10-21')).toEqual([]);
    expect(pastMonthEnds(null, '2026-10-21')).toEqual([]);
  });
});

describe('snapshotPool', () => {
  it('stores today for the pool, and a second run the same day replaces the row', async () => {
    await household();
    expect(await snapshotPool(ctxOf(s.poolA), { today: TODAY_ISO }, run())).toBe(1);
    await snapshotPool(ctxOf(s.poolA), { today: TODAY_ISO }, run());
    const rows = await stored(s.poolA);
    expect(rows).toHaveLength(1);
    // 1 000 − 200 + 1 500 in cash, 2 × 100 invested.
    expect(rows[0]).toMatchObject({
      date: TODAY_ISO,
      cash: '2300.0000',
      investments: '200.0000',
      net: '2500.0000',
    });
    expect(rows[0]?.byCcy).toMatchObject({ EUR: '2500' });
  });

  it('backfill month ends equal what the domain computes for the overview chart', async () => {
    await household();
    const before = await overview();
    expect(await snapshotPool(ctxOf(s.poolA), { today: TODAY_ISO, backfill: true }, run())).toBe(
      10,
    );
    const rows = await stored(s.poolA);
    expect(rows.map((row) => row.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      TODAY_ISO,
    ]);
    // The overview computed these figures itself (nothing was stored yet); the stored month ends
    // for the months it shows must be the same numbers.
    const month = (key: string) => before.evolution.months.indexOf(key);
    for (const row of rows.filter((r) => r.date < TODAY_ISO)) {
      const i = month(row.date.slice(0, 7));
      expect(Number(row.net)).toBeCloseTo(Number(before.evolution.total[i]), 4);
      expect(Number(row.investments)).toBeCloseTo(Number(before.evolution.investments[i]), 4);
    }
    // End of September: 800 in cash and the position bought in March.
    expect(rows.find((row) => row.date === '2026-09-30')).toMatchObject({ net: '1000.0000' });
    expect(rows.find((row) => row.date === '2026-02-28')).toMatchObject({ net: '1000.0000' });
  });

  it('lets the overview chart read the stored snapshot of a past month', async () => {
    await household();
    const owner = ctxOf(s.poolA);
    await run()(owner, (tx) =>
      netWorthSnapshotsRepo.upsertMany(tx, owner, [
        {
          date: '2026-09-30',
          net: '4242.0000',
          cash: '4042.0000',
          savings: '0.0000',
          investments: '200.0000',
          byCcy: {},
        },
      ]),
    );
    const result = await overview();
    const september = result.evolution.months.indexOf('2026-09');
    expect(result.evolution.total[september]).toBe('4242');
    // Today is never read from a snapshot.
    expect(result.evolution.total.at(-1)).toBe('2500');
  });

  it('is refused without the snapshot permission and never touches another pool', async () => {
    await household();
    await expect(
      snapshotPool(systemContext(s.poolA, ['pool.read']), { today: TODAY_ISO }, run()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      snapshotPool(systemContext(s.poolA, ['snapshots.write']), { today: TODAY_ISO }, run()),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await snapshotPool(ctxOf(s.poolA), { today: TODAY_ISO, backfill: true }, run());
    expect(await stored(s.poolB)).toEqual([]);
    expect(await stored(s.poolA)).not.toEqual([]);
  });

  it('stores one row for an empty pool and keeps pools apart', async () => {
    await household();
    await snapshotPool(ctxOf(s.poolB), { today: TODAY_ISO, backfill: true }, run());
    expect(await stored(s.poolB)).toEqual([expect.objectContaining({ net: '0.0000' })]);
    expect(await stored(s.poolA)).toEqual([]);
  });
});
