import { fxRatesRepo, type AppDb } from '@nestvault/db';
import { z } from 'zod';

import type { FxRateProvider } from '../fx-rates/ecb';

import { defineJob } from './define';

export interface FxRefreshJobDeps {
  db: AppDb;
  provider: FxRateProvider;
}

/**
 * `fx.refresh`: the ECB daily reference rates (USD, GBP, CHF) into `fx_rates`, as EUR per unit.
 * Global data: it touches no pool, and a pool's own override in Settings still wins when it reads.
 * Weekends and holidays have no publication, so nothing is written and the last rate stays the
 * newest one. Every run reads the ECB's last 90 days, so a missed run or a revised rate is recovered
 * and the first run is the backfill. Idempotent (an upsert per day and currency, never over a
 * `manual` rate), so a retry or a second run changes nothing.
 */
export function createFxRefreshJob({ db, provider }: FxRefreshJobDeps) {
  return defineJob({
    name: 'fx.refresh',
    payload: z.object({}).strict(),
    // The ECB publishes around 16:00 CET; 17:00 Lisbon is after it.
    schedule: { cron: '0 17 * * *', data: {} },
    singleton: { key: () => 'fx', dedupeSeconds: 3600 },
    async run(_payload, { log }) {
      try {
        const { points, skippedDays } = await provider.recent();
        await fxRatesRepo.upsertMany(
          db,
          points.map((point) => ({ ...point, source: provider.id })),
        );
        if (skippedDays > 0) log.warn({ skippedDays }, 'fx days skipped: a currency is missing');
        log.info({ rates: points.length }, 'fx rates stored');
      } catch (error) {
        // The error may carry a URL or a body: only its type reaches the log.
        log.error({ error: error instanceof Error ? error.name : 'Error' }, 'fx rates failed');
        throw new Error('fx refresh failed', { cause: error });
      }
    },
  });
}
