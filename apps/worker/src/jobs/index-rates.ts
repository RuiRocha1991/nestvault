import { indexRatesRepo, type AppDb } from '@nestvault/db';
import { z } from 'zod';

import {
  INDEX_RATE_INDEXES,
  type IndexRatePoint,
  type IndexRateProvider,
} from '../index-rates/ecb';

import { defineJob } from './define';

/** Where the history starts the first time: the loans of the family are all newer than this. */
export const BACKFILL_FROM = '2015-01';
/** Months re-read every run, so a month the source corrected is corrected here too. */
const RECENT_MONTHS = 14;

export interface IndexRatesJobDeps {
  db: AppDb;
  provider: IndexRateProvider;
  now?: () => Date;
}

const monthsBack = (today: Date, months: number): string => {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, 1));
  return date.toISOString().slice(0, 7);
};

/**
 * `indexrates.refresh`: the monthly Euribor (3, 6 and 12 months) into `index_rates`. Global data: it
 * touches no pool. Idempotent (an upsert per month), so a retry or a second run changes nothing.
 * The first run reads the whole history; later ones only the recent months.
 */
export function createIndexRatesJob({ db, provider, now = () => new Date() }: IndexRatesJobDeps) {
  return defineJob({
    name: 'indexrates.refresh',
    payload: z.object({}).strict(),
    // The ECB publishes the monthly average at the start of the next month.
    schedule: { cron: '0 9 3 * *', data: {} },
    singleton: { key: () => 'indexrates', dedupeSeconds: 3600 },
    async run(_payload, { log }) {
      const failed: string[] = [];
      for (const rateIndex of INDEX_RATE_INDEXES) {
        try {
          const known = await db.transaction((tx) => indexRatesRepo.latest(tx, rateIndex));
          const from = known ? monthsBack(now(), RECENT_MONTHS) : BACKFILL_FROM;
          const points: IndexRatePoint[] = await provider.monthly(rateIndex, from);
          await indexRatesRepo.upsertMany(
            db,
            points.map((point) => ({ ...point, source: provider.id })),
          );
          log.info({ rateIndex, months: points.length, backfill: !known }, 'index rates stored');
        } catch (error) {
          // The error may carry a URL or a body: only its type reaches the log.
          log.error(
            { rateIndex, error: error instanceof Error ? error.name : 'Error' },
            'index rates failed',
          );
          failed.push(rateIndex);
        }
      }
      // The other indexes are stored; the run fails so the queue retries the one that did not work.
      if (failed.length > 0) throw new Error(`${failed.length} index(es) failed`);
    },
  });
}
