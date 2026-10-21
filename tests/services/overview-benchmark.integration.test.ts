import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createOverviewService, logger } from '@nestvault/services';

import { createApiWorld, type ApiWorld } from '../support/api-world';

// NES-49 acceptance: the overview answers in under 300 ms for 20 000 movements and 2 000
// operations. The rows are bulk-inserted with SQL (the services would take minutes); the service is
// then called once to warm up and five times to measure, and the median is what counts.
// Timings are only meaningful without V8 coverage instrumentation (it doubles them), so
// vitest.config.ts leaves this file out of `pnpm test:coverage`; CI runs it in its own step.

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const TRANSACTIONS = 20_000;
const OPERATIONS = 2_000;
const LIMIT_MS = 300;

let world: ApiWorld;

beforeAll(async () => {
  logger.level = 'silent';
  world = await createApiWorld();
});

afterAll(async () => {
  await world.close();
});

describe('overview benchmark', () => {
  it(`answers in under ${LIMIT_MS} ms for ${TRANSACTIONS} movements and ${OPERATIONS} operations`, async () => {
    const s = await world.newScenario();
    const owner = await s.as('owner');
    const holder = (await world.holders.list(owner, s.poolA)).holders[0]?.id ?? '';
    const accountIds: string[] = [];
    for (const name of ['Conta A', 'Conta B']) {
      const account = await world.accounts.create(owner, s.poolA, {
        type: 'checking',
        name,
        currency: 'EUR',
        holderIds: [holder],
        opening: '5000',
        openingDate: '2024-01-01',
      });
      accountIds.push(account.id);
    }
    const portfolio = await world.portfolios.create(owner, s.poolA, {
      name: 'Longo prazo',
      color: '#9D6BFF',
      currency: 'EUR',
    });
    const assetIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const asset = await world.assets.create(owner, s.poolA, {
        ticker: `BENCH${i}`,
        name: `Benchmark ${i}`,
        type: 'etf',
        currency: 'EUR',
        dps: '1.2',
        divMonths: [3, 6, 9, 12],
      });
      await world.assets.setPrice(owner, s.poolA, asset.id, { date: '2024-06-01', price: '10' });
      await world.assets.setPrice(owner, s.poolA, asset.id, { date: '2026-10-01', price: '14' });
      assetIds.push(asset.id);
    }
    const categories = (await world.categories.list(owner, s.poolA)).categories;
    const groceries = categories.find((category) => category.systemKey === 'groceries')?.id ?? '';

    await world.database.asMigrator(async (pool) => {
      await pool.query('begin');
      try {
        await pool.query("select set_config('app.pool_id', $1, true)", [s.poolA]);
        await pool.query(
          `insert into transactions (id, pool_id, account_id, date, description, amount, category_id, hash)
           select gen_random_uuid(), $1::uuid, ($2::uuid[])[1 + g % 2], date '2024-01-01' + (g % 1000),
                  'Movimento ' || g, -(1 + g % 97), $3::uuid, 'bench' || g
           from generate_series(1, $4::int) g`,
          [s.poolA, accountIds, groceries, TRANSACTIONS],
        );
        await pool.query(
          `insert into investment_ops (id, pool_id, portfolio_id, asset_id, type, date, qty, price, fee)
           select gen_random_uuid(), $1::uuid, $2::uuid, ($3::uuid[])[1 + g % 10], 'buy',
                  date '2024-02-01' + (g % 900), 1 + g % 5, 10 + g % 4, 0
           from generate_series(1, $4::int) g`,
          [s.poolA, portfolio.id, assetIds, OPERATIONS],
        );
      } finally {
        await pool.query('commit');
      }
    });

    const service = createOverviewService({
      auth: world.auth,
      identity: world.identity,
      run: world.database.withPool,
      now: () => new Date('2026-10-21T12:00:00Z'),
    });
    const timed = async (range: string) => {
      const started = performance.now();
      await service.get(owner, s.poolA, { range });
      return performance.now() - started;
    };

    await timed('12'); // warm-up: connections, JIT, plan cache
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await timed('12'));
    runs.sort((a, b) => a - b);
    const median = runs[2] ?? Infinity;
    expect(median, `runs (ms): ${runs.map((run) => run.toFixed(0)).join(', ')}`).toBeLessThan(
      LIMIT_MS,
    );

    // The 24-month view reads the same rows once more per month: still a single round trip.
    expect(await timed('24')).toBeLessThan(LIMIT_MS * 2);
  });
});
