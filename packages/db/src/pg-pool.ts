import { Pool } from 'pg';

/**
 * A `pg` pool with an error handler. An idle client can fail (database restart); that must never
 * crash the process, and the log line never carries connection details.
 */
export function createPgPool(
  connectionString: string,
  maxConnections: number,
  name: 'app' | 'identity',
): Pool {
  const pool = new Pool({
    connectionString,
    max: maxConnections,
    application_name: `nestvault-${name}`,
  });
  pool.on('error', () => {
    console.error(`Unexpected error on an idle ${name} database connection`);
  });
  return pool;
}
