import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import { createPgPool } from '../pg-pool';

import * as schema from './schema';

export type AppDb = NodePgDatabase<typeof schema>;
/** The transaction handed to repositories by `withPool`. */
export type PoolTx = Parameters<Parameters<AppDb['transaction']>[0]>[0];

export interface AppDatabase {
  readonly db: AppDb;
  readonly pool: Pool;
  close(): Promise<void>;
}

/**
 * Connection to `nestvault_app` as `app_rw` (no BYPASSRLS, not the table owner). Queries must go
 * through `withPool`, never through `db` directly, or RLS sees no pool and returns nothing.
 */
export function createAppDatabase(connectionString: string, maxConnections = 10): AppDatabase {
  const pool = createPgPool(connectionString, maxConnections, 'app');
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}
