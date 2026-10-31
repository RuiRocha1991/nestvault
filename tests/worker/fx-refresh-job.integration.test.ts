import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { createAppDatabase, fxRatesRepo } from '@nestvault/db';
import { createLogger } from '@nestvault/services';

import type { FxRatePoint, FxRateProvider } from '../../apps/worker/src/fx-rates/ecb';
import { createFxRefreshJob } from '../../apps/worker/src/jobs/fx-refresh';
import { openTestDatabase } from '../db/harness';

// `fx_rates` is seeded reference data that tests never truncate and other suites read, so this
// suite writes only on days of 1999 and removes them afterwards.
const DAYS = ['1999-03-01', '1999-03-02'];

const database = openTestDatabase(1);
const worker = createAppDatabase(testEnv().TEST_DATABASE_URL_WORKER, 2);
const log = createLogger({ level: 'silent' });
const info = { runId: 'run', jobName: 'fx.refresh', attempt: 1, log };

const cleanup = () =>
  database.asMigrator((pool) => pool.query(`DELETE FROM fx_rates WHERE date < '2000-01-01'`));

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await worker.close();
  await database.close();
});

const points = (date: string, rates: [string, string, string]): FxRatePoint[] => [
  { ccy: 'CHF', date, eurRate: rates[0] },
  { ccy: 'GBP', date, eurRate: rates[1] },
  { ccy: 'USD', date, eurRate: rates[2] },
];

const provider = (points: FxRatePoint[], skippedDays = 0, fail = false) => {
  const recent = vi.fn(() =>
    fail
      ? Promise.reject(new Error('the ECB answered 503'))
      : Promise.resolve({ points, skippedDays }),
  );
  const source: FxRateProvider = { id: 'ecb', recent };
  return { source, recent };
};

const seed = (date: string, rate: string, source: string) =>
  fxRatesRepo.upsertMany(
    worker.db,
    points(date, [rate, rate, rate]).map((p) => ({ ...p, source })),
  );

const stored = () => worker.db.transaction((tx) => fxRatesRepo.latestAsOf(tx, '1999-12-31'));

describe('fx.refresh', () => {
  it('is a daily scheduled job at 17:00 with an empty strict payload', () => {
    const job = createFxRefreshJob({ db: worker.db, provider: provider([]).source });
    expect(job.name).toBe('fx.refresh');
    expect(job.schedule?.cron).toBe('0 17 * * *');
    expect(() => {
      job.validate({});
    }).not.toThrow();
    expect(() => {
      job.validate({ days: 1 });
    }).toThrow();
  });

  it('stores the window, and a second run for the same date changes nothing', async () => {
    const { source, recent } = provider([
      ...points(DAYS[0] as string, ['1.00000000', '1.00000000', '1.00000000']),
      ...points(DAYS[1] as string, ['1.07515321', '1.15054939', '0.86058520']),
    ]);
    const job = createFxRefreshJob({ db: worker.db, provider: source });
    await job.execute({}, info);
    const first = await stored();
    await job.execute({}, info);
    expect(await stored()).toEqual(first);
    expect(recent).toHaveBeenCalledTimes(2);
    // latestAsOf keeps the newest day per currency: the second day.
    expect(first).toEqual([
      { ccy: 'CHF', date: DAYS[1], eurRate: '1.07515321', source: 'ecb' },
      { ccy: 'GBP', date: DAYS[1], eurRate: '1.15054939', source: 'ecb' },
      { ccy: 'USD', date: DAYS[1], eurRate: '0.86058520', source: 'ecb' },
    ]);
  });

  it('never overwrites a manual rate', async () => {
    await seed(DAYS[0] as string, '2.00000000', 'manual');
    await createFxRefreshJob({
      db: worker.db,
      provider: provider(points(DAYS[0] as string, ['1.1', '1.2', '0.9'])).source,
    }).execute({}, info);
    expect(await stored()).toEqual(
      points(DAYS[0] as string, ['2.00000000', '2.00000000', '2.00000000']).map((p) => ({
        ...p,
        source: 'manual',
      })),
    );
  });

  it('logs skipped days by count only', async () => {
    const warn = vi.fn();
    const spy = { ...log, info: vi.fn(), warn } as unknown as typeof log;
    await createFxRefreshJob({
      db: worker.db,
      provider: provider(points(DAYS[0] as string, ['1', '1', '1']), 2).source,
    }).execute({}, { ...info, log: spy });
    expect(warn).toHaveBeenCalledWith({ skippedDays: 2 }, expect.any(String));
  });

  it('corrects a rate the source revised for the same date', async () => {
    await seed(DAYS[0] as string, '1.00000000', 'ecb');
    await createFxRefreshJob({
      db: worker.db,
      provider: provider(points(DAYS[0] as string, ['1.1', '1.2', '0.9'])).source,
    }).execute({}, info);
    expect((await stored()).map((row) => row.eurRate)).toEqual([
      '1.10000000',
      '1.20000000',
      '0.90000000',
    ]);
  });

  it('treats an injection payload as data in the repository functions', async () => {
    const payload = "' OR 1=1 --";
    await expect(
      fxRatesRepo.upsertMany(worker.db, [
        { ccy: 'USD', date: DAYS[0] as string, eurRate: '1', source: payload },
      ]),
    ).rejects.toThrow();
    expect((await stored()).length).toBe(0);
  });

  it('fails the run without the source message in the log', async () => {
    const lines: unknown[] = [];
    const spy = {
      ...log,
      info: vi.fn(),
      error: (fields: unknown) => lines.push(fields),
    } as unknown as typeof log;
    await expect(
      createFxRefreshJob({ db: worker.db, provider: provider([], 0, true).source }).execute(
        {},
        { ...info, log: spy },
      ),
    ).rejects.toThrow('fx refresh failed');
    expect(JSON.stringify(lines)).not.toContain('503');
    expect(lines).toEqual([{ error: 'Error' }]);
  });
});
