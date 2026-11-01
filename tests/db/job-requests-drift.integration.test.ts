import { afterAll, describe, expect, it } from 'vitest';

import { POOL_JOB_REQUESTS } from '@nestvault/db';

import { openTestDatabase } from './harness';

const database = openTestDatabase(1);

afterAll(async () => {
  await database.close();
});

// The Drizzle schema builds its check from POOL_JOB_REQUESTS; the migration holds a literal copy. When
// the constant grows, a new migration must replace the constraint, and this test says so.
describe('job_requests job names', () => {
  it('the CHECK in the database lists exactly POOL_JOB_REQUESTS', async () => {
    const result = await database.asMigrator((pool) =>
      pool.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint
         where conname = 'job_requests_job_known' and conrelid = 'public.job_requests'::regclass`,
      ),
    );
    const def = result.rows[0]?.def ?? '';
    const names = [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
    expect(names).toEqual([...POOL_JOB_REQUESTS].sort());
  });
});
