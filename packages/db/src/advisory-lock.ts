import { sql, type SQL } from 'drizzle-orm';

/** What both a Drizzle identity executor and an app transaction can do. */
interface Executes {
  execute(query: SQL): PromiseLike<unknown>;
}

/**
 * Takes a transaction-scoped advisory lock for `(poolId, resource)`; it is released at commit or
 * rollback. Used to count and insert in one step so two parallel requests cannot both pass a plan
 * limit. The key is hashed in Postgres from bound parameters (never concatenated into the SQL).
 */
export async function lockPoolResource(
  tx: Executes,
  poolId: string,
  resource: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${poolId}::text || ':' || ${resource}::text, 0))`,
  );
}
