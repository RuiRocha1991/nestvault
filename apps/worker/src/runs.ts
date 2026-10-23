import type { Pool } from 'pg';

export interface RunRow {
  job: string;
  state: string;
  attempts: number;
  createdOn: Date;
  durationMs: number | null;
  /** Only the sanitised error the runtime stored; never the payload. */
  error: string | null;
}

/** The last `limit` runs, newest first, optionally only the failed ones. The payload is not read. */
export async function lastRuns(
  pool: Pick<Pool, 'query'>,
  options: { limit: number; failedOnly?: boolean },
): Promise<RunRow[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit), 1), 500);
  const result = await pool.query<{
    name: string;
    state: string;
    retry_count: number;
    created_on: Date;
    duration_ms: string | null;
    error: string | null;
  }>(
    `SELECT name, state::text AS state, retry_count, created_on,
            (extract(epoch FROM (completed_on - started_on)) * 1000)::bigint AS duration_ms,
            output ->> 'message' AS error
       FROM pgboss.job
      WHERE ($2::boolean IS NOT TRUE OR state = 'failed')
      ORDER BY created_on DESC
      LIMIT $1`,
    [limit, options.failedOnly ?? false],
  );
  return result.rows.map((row) => ({
    job: row.name,
    state: row.state,
    attempts: row.retry_count + 1,
    createdOn: row.created_on,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    error: row.error,
  }));
}

/** One line per run for the terminal. */
export function formatRuns(rows: readonly RunRow[]): string {
  if (rows.length === 0) return 'No runs yet.';
  const lines = rows.map((row) =>
    [
      row.createdOn.toISOString(),
      row.state.padEnd(9),
      row.job.padEnd(24),
      `${row.durationMs === null ? '-' : String(row.durationMs)} ms`.padStart(10),
      `try ${String(row.attempts)}`,
      row.error ?? '',
    ]
      .join('  ')
      .trimEnd(),
  );
  return lines.join('\n');
}
