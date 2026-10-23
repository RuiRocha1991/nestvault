// `pnpm worker:runs [--failed] [--limit N]`: the last job runs, read from the pgboss schema.
// Operational only: there is no screen or route for it (a platform-admin UI waits for a deploy).
import { workerEnv } from '@nestvault/config/node';
import { Pool } from 'pg';

import { formatRuns, lastRuns } from './runs';

const args = process.argv.slice(2);
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 20;
if (!Number.isInteger(limit) || limit < 1) {
  console.error('Usage: pnpm worker:runs [--failed] [--limit N]');
  process.exit(2);
}

const pool = new Pool({
  connectionString: workerEnv().DATABASE_URL_WORKER,
  max: 1,
  application_name: 'nestvault-worker-runs',
});
try {
  console.log(formatRuns(await lastRuns(pool, { limit, failedOnly: args.includes('--failed') })));
} catch (error) {
  const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
  console.error(`Could not read the runs (error code: ${code}). Is the database up and migrated?`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
