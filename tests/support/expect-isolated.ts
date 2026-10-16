import { expect } from 'vitest';

import type { PoolContext, PoolTx } from '@nestvault/db';

import { createTwoPools, type TestDatabase, type TestPool } from '../db/harness';

// `expectIsolated(repoFn)`: the repository half of the isolation suite (NES-30). It seeds data in
// pool B, runs the function under test with the context of pool A and demands that it finds,
// changes and deletes nothing of B. Every repository function of the `app` database gets one call.

interface IsolationBase<Seed> {
  database: TestDatabase;
  /** Creates data in pool B (run with B's context) and returns what the call needs, e.g. the row id. */
  seed(tx: PoolTx, ctxB: PoolContext, pools: { a: TestPool; b: TestPool }): Promise<Seed>;
  /** The repository function, called as pool A with B's identifiers. */
  run(tx: PoolTx, ctxA: PoolContext, seed: Seed): Promise<unknown>;
  /** Pool B's data as B sees it; must be identical before and after the call. */
  snapshot(tx: PoolTx, ctxB: PoolContext, seed: Seed): Promise<unknown>;
}

export type IsolationCase<Seed> = IsolationBase<Seed> &
  (
    | {
        /** The call returns nothing: `undefined`, `null`, `[]`, `0` or an empty result. */
        outcome?: 'empty';
      }
    | {
        /**
         * The call throws. `refusal` says which error counts as the refusal (a Postgres code, a
         * `NotFoundError`, ...): any other failure, such as a SQL syntax error, fails the check.
         */
        outcome: 'rejects';
        refusal: (error: unknown) => boolean;
      }
  );

/** True for the values a repository returns when it found or changed nothing. */
export function isEmptyResult(value: unknown): boolean {
  if (value === undefined || value === null || value === 0 || value === false) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    const result = value as { rowCount?: unknown; rows?: unknown };
    if (typeof result.rowCount === 'number') return result.rowCount === 0;
    if (Array.isArray(result.rows)) return result.rows.length === 0;
  }
  return false;
}

export async function expectIsolated<Seed>(options: IsolationCase<Seed>): Promise<void> {
  const { database } = options;
  const pools = createTwoPools();
  const { a, b } = pools;
  const seed = await database.withPool(b.ctx, (tx) => options.seed(tx, b.ctx, pools));
  const before = await database.withPool(b.ctx, (tx) => options.snapshot(tx, b.ctx, seed));

  let result: unknown;
  let failure: unknown;
  try {
    result = await database.withPool(a.ctx, (tx) => options.run(tx, a.ctx, seed));
  } catch (error) {
    failure = error;
  }

  if (options.outcome === 'rejects') {
    expect(failure, 'the call must refuse pool B’s data').toBeDefined();
    expect(
      options.refusal(failure),
      `an unrelated error is not a refusal: ${String(failure)}`,
    ).toBe(true);
  } else {
    expect(failure, 'the call must not fail, it must find nothing').toBeUndefined();
    expect(isEmptyResult(result), 'pool A got something of pool B').toBe(true);
  }
  const after = await database.withPool(b.ctx, (tx) => options.snapshot(tx, b.ctx, seed));
  expect(after, 'pool B’s data changed').toEqual(before);
}
