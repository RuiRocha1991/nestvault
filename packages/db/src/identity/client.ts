import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import { createPgPool } from '../pg-pool';

import * as schema from './schema';

export interface IdentityDatabase {
  readonly db: NodePgDatabase<typeof schema>;
  readonly pool: Pool;
  close(): Promise<void>;
}

/**
 * What a repository needs to run a statement: the connection or a transaction opened on it. Writes
 * that must commit together (a pool, its owner and the audit entry) take the transaction.
 */
export type IdentityExecutor = Pick<
  IdentityDatabase['db'],
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;

/** Connection to `nestvault_identity` as `identity_rw` (it cannot reach the app database). */
export function createIdentityDatabase(
  connectionString: string,
  maxConnections = 10,
): IdentityDatabase {
  const pool = createPgPool(connectionString, maxConnections, 'identity');
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}
