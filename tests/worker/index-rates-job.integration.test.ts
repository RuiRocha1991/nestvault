import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { createAppDatabase, indexRatesRepo } from '@nestvault/db';
import { createLogger } from '@nestvault/services';

import type { IndexRateProvider } from '../../apps/worker/src/index-rates/ecb';
import { createIndexRatesJob, BACKFILL_FROM } from '../../apps/worker/src/jobs/index-rates';
import { openTestDatabase } from '../db/harness';

const database = openTestDatabase(1);
// The job's own connection: the role the worker process runs with.
const worker = createAppDatabase(testEnv().TEST_DATABASE_URL_WORKER, 2);
const log = createLogger({ level: 'silent' });
const info = { runId: 'run', jobName: 'indexrates.refresh', attempt: 1, log };

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await worker.close();
  await database.close();
});

const point = (
  rateIndex: 'euribor_3m' | 'euribor_6m' | 'euribor_12m',
  period: string,
  rate: string,
) => ({
  rateIndex,
  period,
  rate,
});

/** A provider that returns the same months for every index and remembers what it was asked. */
const provider = (
  months: [string, string][],
  failFor?: string,
): IndexRateProvider & {
  monthly: ReturnType<typeof vi.fn>;
} => ({
  id: 'ecb',
  monthly: vi.fn((rateIndex: 'euribor_3m' | 'euribor_6m' | 'euribor_12m') =>
    failFor === rateIndex
      ? Promise.reject(new Error('the ECB answered 503'))
      : Promise.resolve(months.map(([period, rate]) => point(rateIndex, period, rate))),
  ),
});

const allRows = () =>
  worker.db.transaction(async (tx) => {
    const rows = [];
    for (const index of ['euribor_3m', 'euribor_6m', 'euribor_12m']) {
      rows.push(...(await indexRatesRepo.list(tx, index, '2000-01-01')));
    }
    return rows;
  });

describe('indexrates.refresh', () => {
  it('is a scheduled job with an empty strict payload', () => {
    const job = createIndexRatesJob({ db: worker.db, provider: provider([]) });
    expect(job.name).toBe('indexrates.refresh');
    expect(job.schedule?.cron).toBe('0 9 3 * *');
    expect(() => {
      job.validate({});
    }).not.toThrow();
    expect(() => {
      job.validate({ backMonths: 1 });
    }).toThrow();
  });

  it('the first run reads the whole history, for every index', async () => {
    const source = provider([
      ['2026-08-01', '2.1'],
      ['2026-09-01', '2.2'],
    ]);
    await createIndexRatesJob({ db: worker.db, provider: source }).execute({}, info);
    expect(source.monthly.mock.calls).toEqual([
      ['euribor_3m', BACKFILL_FROM],
      ['euribor_6m', BACKFILL_FROM],
      ['euribor_12m', BACKFILL_FROM],
    ]);
    expect(await allRows()).toHaveLength(6);
  });

  it('later runs read only the recent months and a second run changes nothing', async () => {
    const now = () => new Date('2026-10-03T09:00:00Z');
    const source = provider([['2026-09-01', '2.2']]);
    const job = createIndexRatesJob({ db: worker.db, provider: source, now });
    await job.execute({}, info);
    const first = await allRows();
    source.monthly.mockClear();
    await job.execute({}, info);
    expect(source.monthly.mock.calls.map((call: unknown[]) => String(call[1]))).toEqual([
      '2025-08',
      '2025-08',
      '2025-08',
    ]);
    const second = await allRows();
    const stable = (rows: typeof first) =>
      rows.map((row) => `${row.rateIndex}|${row.period}|${row.rate}|${row.source}`);
    expect(stable(second)).toEqual(stable(first));
  });

  it('corrects a month the source revised', async () => {
    const now = () => new Date('2026-10-03T09:00:00Z');
    await createIndexRatesJob({
      db: worker.db,
      provider: provider([['2026-09-01', '2.2']]),
      now,
    }).execute({}, info);
    await createIndexRatesJob({
      db: worker.db,
      provider: provider([['2026-09-01', '2.25']]),
      now,
    }).execute({}, info);
    const rows = await allRows();
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.rate === '2.250000')).toBe(true);
  });

  it('stores the indexes that worked and fails the run for the one that did not', async () => {
    const source = provider([['2026-09-01', '2.2']], 'euribor_6m');
    await expect(
      createIndexRatesJob({ db: worker.db, provider: source }).execute({}, info),
    ).rejects.toThrow('1 index(es) failed');
    expect((await allRows()).map((row) => row.rateIndex).sort()).toEqual([
      'euribor_12m',
      'euribor_3m',
    ]);
  });

  it('does not log the error message of the source', async () => {
    const lines: unknown[] = [];
    const spy = {
      ...log,
      info: vi.fn(),
      error: (fields: unknown) => lines.push(fields),
    } as unknown as typeof log;
    await expect(
      createIndexRatesJob({ db: worker.db, provider: provider([], 'euribor_3m') }).execute(
        {},
        { ...info, log: spy },
      ),
    ).rejects.toThrow();
    expect(JSON.stringify(lines)).not.toContain('503');
    expect(lines).toEqual([{ rateIndex: 'euribor_3m', error: 'Error' }]);
  });
});
