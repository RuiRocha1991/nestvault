// `pnpm db:migrate`: applies both migration sets as the migration user.
import { migratorEnv } from '@nestvault/config/node';

import { runMigrations } from './migrate';

const env = migratorEnv();

try {
  await runMigrations({ identityUrl: env.MIGRATOR_URL_IDENTITY, appUrl: env.MIGRATOR_URL_APP });
  console.log('Migrations applied to nestvault_identity and nestvault_app.');
} catch (error) {
  // Never print the connection string or the driver error body (it may carry credentials).
  const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
  console.error(`Migration failed (error code: ${code}). Is the database up? Try: pnpm db:up`);
  process.exit(1);
}
