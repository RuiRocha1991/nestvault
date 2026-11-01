import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { openTestDatabase } from './harness';

const database = openTestDatabase(1);

afterAll(async () => {
  await database.close();
});

const MIGRATION = readFileSync(
  resolve(
    import.meta.dirname,
    '../../packages/db/migrations/app/0022_reminder_lifecycle_pool_reconcile.sql',
  ),
  'utf8',
);

// The backfill must not turn plans last touched months ago into a burst of old reminders: it is the
// later of the last edit and the first day of the current month (Lisbon). The expression is taken from
// the migration itself, so the test cannot drift from what ran.
describe('plans.activated_at backfill (migration 0022)', () => {
  const expression = /SET "activated_at" = (.+?);--> statement-breakpoint/s.exec(MIGRATION)?.[1];

  const backfill = async (updatedAt: string) => {
    const result = await database.asMigrator((pool) =>
      pool.query<{ value: Date; month_start: Date }>(
        `select (${(expression ?? '').replace('"updated_at"', '$1::timestamptz')}) as value,
                (date_trunc('month', now() at time zone 'Europe/Lisbon') at time zone 'Europe/Lisbon') as month_start`,
        [updatedAt],
      ),
    );
    return result.rows[0];
  };

  it('finds the expression in the migration', () => {
    expect(expression).toContain('GREATEST("updated_at"');
  });

  it('lifts a plan last edited months ago to the start of the current month', async () => {
    const row = await backfill('2020-01-15T10:00:00Z');
    expect(row?.value.toISOString()).toBe(row?.month_start.toISOString());
  });

  it('keeps the edit time of a plan edited this month', async () => {
    const edited = new Date().toISOString();
    const row = await backfill(edited);
    expect(row?.value.getTime()).toBeGreaterThanOrEqual(row?.month_start.getTime() ?? 0);
    expect(row?.value.toISOString()).toBe(edited);
  });
});
