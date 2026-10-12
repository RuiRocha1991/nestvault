import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

export const MIGRATIONS_FOLDERS = {
  identity: fileURLToPath(new URL('../migrations/identity', import.meta.url)),
  app: fileURLToPath(new URL('../migrations/app', import.meta.url)),
} as const;

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

/** Applies pending migrations to both databases. Safe to run any number of times. */
export async function runMigrations(targets: MigrationTargets): Promise<void> {
  await migrateOne(targets.identityUrl, MIGRATIONS_FOLDERS.identity);
  await migrateOne(targets.appUrl, MIGRATIONS_FOLDERS.app);
}
