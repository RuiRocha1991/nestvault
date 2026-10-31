// `pnpm worker:backfill-snapshots [--pool <uuid>]`: rebuilds the net worth of every past month end
// (and today) from the transactions and operations, for every pool or just one. Safe to repeat: a
// day's row is replaced. Use it after importing history, or after correcting old movements.
import { workerEnv } from '@nestvault/config/node';
import { createIdentityDatabase, poolsRepo } from '@nestvault/db';
import { createLogger, snapshotPool } from '@nestvault/services';
import { z } from 'zod';

import { createWorkerPoolRunner } from './database';
import { lisbonDay } from './jobs/tenant';
import { forEachPool } from './pools';

const args = process.argv.slice(2);
const poolFlag = args.indexOf('--pool');
const only = poolFlag >= 0 ? z.uuid().safeParse(args[poolFlag + 1]) : null;
if (only && !only.success) {
  console.error('Usage: pnpm worker:backfill-snapshots [--pool <uuid>]');
  process.exit(2);
}

const env = workerEnv();
const log = createLogger();
const identity = createIdentityDatabase(env.DATABASE_URL_IDENTITY, 1);
const run = createWorkerPoolRunner(env.DATABASE_URL_WORKER);
let exitCode = 0;
try {
  const today = lisbonDay(new Date());
  const known = await poolsRepo.listIds(identity.db);
  const poolIds = only?.success ? known.filter((id) => id === only.data) : known;
  if (only?.success && poolIds.length === 0) {
    console.error('No pool has that id; nothing was written.');
    exitCode = 2;
  } else {
    await forEachPool(poolIds, ['pool.read', 'snapshots.write'], log, async (ctx) => {
      const stored = await snapshotPool(ctx, { today, backfill: true }, run);
      log.info({ stored }, 'snapshots rebuilt');
    });
  }
} catch (error) {
  // Only the error type: a driver message can carry values.
  log.error({ error: error instanceof Error ? error.name : 'Error' }, 'backfill failed');
  console.error(
    'The backfill failed for at least one pool; see the log above. It is safe to rerun.',
  );
  exitCode = 1;
} finally {
  await identity.close();
  process.exit(exitCode);
}
