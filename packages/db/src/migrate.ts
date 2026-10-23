import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';

export const MIGRATIONS_FOLDERS = {
  identity: fileURLToPath(new URL('../migrations/identity', import.meta.url)),
  app: fileURLToPath(new URL('../migrations/app', import.meta.url)),
} as const;

/** Schema of the job queues (pg-boss). Owned by the migration user, used by the worker role. */
export const JOB_SCHEMA = 'pgboss';

export interface MigrationTargets {
  /** Connection of `nestvault_migrator` to the identity database. */
  identityUrl: string;
  /** Connection of `nestvault_migrator` to the app database. */
  appUrl: string;
}

async function migrateOne(connectionString: string, migrationsFolder: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1, application_name: 'nestvault-migrator' });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

/**
 * Installs or upgrades the job queues with pg-boss's own versioned migrations, as the migration
 * user, then lets `worker_rw` use them. The role is created by docker/postgres/init (see
 * `pnpm db:worker-role`); when it does not exist yet the grants are skipped and the next run adds them.
 * pg-boss makes one table per queue at run time, so the worker also gets CREATE in this schema only.
 */
async function installJobQueues(connectionString: string): Promise<void> {
  const boss = new PgBoss({
    connectionString,
    schema: JOB_SCHEMA,
    application_name: 'nestvault-migrator',
    max: 1,
    migrate: true,
    createSchema: true,
    supervise: false,
    schedule: false,
  });
  boss.on('error', () => undefined);
  try {
    await boss.start();
  } finally {
    await boss.stop({ graceful: false });
  }
  const pool = new Pool({ connectionString, max: 1, application_name: 'nestvault-migrator' });
  try {
    await pool.query(`
      DO $grants$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker_rw') THEN
          GRANT USAGE, CREATE ON SCHEMA ${JOB_SCHEMA} TO worker_rw;
          GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${JOB_SCHEMA} TO worker_rw;
          GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${JOB_SCHEMA} TO worker_rw;
          GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${JOB_SCHEMA} TO worker_rw;
        END IF;
      END $grants$`);
  } finally {
    await pool.end();
  }
}

/** Applies pending migrations to both databases and installs the job queues in the app database. Safe to run any number of times. */
export async function runMigrations(targets: MigrationTargets): Promise<void> {
  await migrateOne(targets.identityUrl, MIGRATIONS_FOLDERS.identity);
  await migrateOne(targets.appUrl, MIGRATIONS_FOLDERS.app);
  await installJobQueues(targets.appUrl);
}
