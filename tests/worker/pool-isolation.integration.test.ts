import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { newId } from '@nestvault/db';
import { createLogger } from '@nestvault/services';

import { createWorkerPoolRunner } from '../../apps/worker/src/database';
import { forEachPool } from '../../apps/worker/src/pools';
import { failureCodeOf, openTestDatabase, PG } from '../db/harness';
import { isolationProbe, probeUnfiltered } from '../db/probe';
import { asSystem } from '../support/factories';

const database = openTestDatabase(1);
/** `withPool` as the worker builds it: connected as `worker_rw`, not `app_rw`. */
const withPool = createWorkerPoolRunner(testEnv().TEST_DATABASE_URL_WORKER);
const log = createLogger({ level: 'silent' });

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
});

describe('system context', () => {
  it('sees only the pool it was opened for, even with a query that has no filter', async () => {
    const [a, b] = [newId(), newId()];
    await forEachPool([a, b], [], log, (ctx) =>
      withPool(ctx, (tx) =>
        probeUnfiltered
          .insertForPool(tx, { id: newId(), poolId: ctx.poolId, label: `row-of-${ctx.poolId}` })
          .then(() => undefined),
      ),
    );

    const seen: Record<string, string[]> = {};
    await forEachPool([a, b], [], log, (ctx) =>
      withPool(ctx, async (tx) => {
        seen[ctx.poolId] = (await probeUnfiltered.list(tx)).map((row) => row.poolId);
      }),
    );
    expect(seen).toEqual({ [a]: [a], [b]: [b] });
  });

  it('cannot write a row for another pool', async () => {
    const [a, b] = [newId(), newId()];
    let code = '';
    await forEachPool([a], [], log, async (ctx) => {
      code = await failureCodeOf(
        withPool(ctx, (tx) =>
          tx.insert(isolationProbe).values({ id: newId(), poolId: b, label: 'smuggled' }),
        ),
      );
    });
    expect(code).toBe(PG.rlsViolation);
    const rows = await withPool(asSystem({ poolId: b }), (tx) => probeUnfiltered.list(tx));
    expect(rows).toEqual([]);
  });

  it('worker_rw can neither bypass RLS nor act as a superuser', async () => {
    const [a] = [newId()];
    await forEachPool([a], [], log, (ctx) =>
      withPool(ctx, (tx) =>
        probeUnfiltered
          .insertForPool(tx, { id: newId(), poolId: a, label: 'x' })
          .then(() => undefined),
      ),
    );
    const { rows } = await database.asMigrator((pool) =>
      pool.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
        "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'worker_rw'",
      ),
    );
    expect(rows).toEqual([{ rolbypassrls: false, rolsuper: false }]);
  });
});
