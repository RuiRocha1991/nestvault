import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { testEnv } from '@nestvault/config/node';
import { createAppDatabase, jobRequestsRepo, type PendingJobRequest } from '@nestvault/db';
import { createLogger } from '@nestvault/services';

import { createRequestRelay } from '../../apps/worker/src/request-relay';
import { UnknownJobError } from '../../apps/worker/src/runtime';
import { createTwoPools, failureCodeOf, openTestDatabase } from '../db/harness';

// Pools are random per test, so tests neither truncate nor disturb parallel files.
const database = openTestDatabase(2);
const worker = createAppDatabase(testEnv().TEST_DATABASE_URL_WORKER, 2);
const log = createLogger({ level: 'silent' });
const { withPool } = database;

afterAll(async () => {
  await worker.close();
  await database.close();
});

const mine = (poolIds: string[]) => async () =>
  (await jobRequestsRepo.pending(worker.db, 1000)).filter((r) => poolIds.includes(r.poolId));

type Enqueue = (name: string, payload: { poolId: string }) => Promise<string | null>;
const INJECTION = "x'; drop table job_requests; --";

describe('job_requests: who may write and read', () => {
  it('only request_pool_job writes it, and only for the pool of the transaction', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => jobRequestsRepo.request(tx, a.ctx, 'deposits.link'));
    await withPool(a.ctx, (tx) => jobRequestsRepo.request(tx, a.ctx, 'deposits.link'));
    const rows = await mine([a.poolId, b.poolId])();
    // One pending row per pool and job, for the pool the transaction was in.
    expect(rows.map((r) => r.poolId)).toEqual([a.poolId]);
    // No direct access for the app role, in either direction.
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => tx.execute(sql`select * from job_requests`))),
    ).toBe('42501');
    expect(
      await failureCodeOf(
        withPool(b.ctx, (tx) =>
          tx.execute(
            sql`insert into job_requests (pool_id, job_name) values (${a.poolId}, 'deposits.link')`,
          ),
        ),
      ),
    ).toBe('42501');
    // The function refuses an unknown job (check constraint, the payload is data) and a call outside a pool.
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => tx.execute(sql`select request_pool_job(${INJECTION})`)),
      ),
    ).toBe('23514');
    expect(
      await failureCodeOf(database.app.db.execute(sql`select request_pool_job('deposits.link')`)),
    ).toBe('42501');
    await jobRequestsRepo.settle(worker.db, rows[0] as PendingJobRequest);
  });

  it('the worker can read and delete but not insert or update', async () => {
    const privileges = await database.asMigrator((pool) =>
      pool.query<{ p: string; ok: boolean }>(
        `select p, has_table_privilege('worker_rw', 'public.job_requests', p) as ok
         from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p`,
      ),
    );
    expect(Object.fromEntries(privileges.rows.map((r) => [r.p, r.ok]))).toEqual({
      SELECT: true,
      INSERT: false,
      UPDATE: false,
      DELETE: true,
      TRUNCATE: false,
    });
    const app = await database.asMigrator((pool) =>
      pool.query<{ ok: boolean }>(
        `select has_table_privilege('app_rw', 'public.job_requests', 'SELECT') as ok`,
      ),
    );
    expect(app.rows[0]?.ok).toBe(false);
  });
});

describe('request relay', () => {
  it('turns a request into one run for its pool and removes it', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => jobRequestsRepo.request(tx, a.ctx, 'deposits.link'));
    const enqueue = vi.fn<Enqueue>(() => Promise.resolve('run-1'));
    const relay = createRequestRelay({ db: worker.db, enqueue, log });
    await relay.tick();
    expect(enqueue).toHaveBeenCalledWith('deposits.link', { poolId: a.poolId });
    expect(enqueue).not.toHaveBeenCalledWith('deposits.link', { poolId: b.poolId });
    expect(await mine([a.poolId])()).toEqual([]);
  });

  it('keeps the request while the queue still holds a run in its window, then drops it when old', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => jobRequestsRepo.request(tx, a.ctx, 'deposits.link'));
    const enqueue = vi.fn<Enqueue>(() => Promise.resolve(null));
    let clock = Date.now();
    const relay = createRequestRelay({ db: worker.db, enqueue, log, now: () => new Date(clock) });
    await relay.tick();
    expect(await mine([a.poolId])()).toHaveLength(1);
    clock += 6 * 60_000;
    await relay.tick();
    expect(await mine([a.poolId])()).toEqual([]);
  });

  it('retries a failing enqueue per row with a growing backoff, one error log per attempt', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => jobRequestsRepo.request(tx, a.ctx, 'deposits.link'));
    const enqueue = vi.fn<Enqueue>(() => Promise.reject(new Error('queue down')));
    const errors = vi.fn();
    const quiet = { ...log, error: errors, child: () => quiet } as unknown as typeof log;
    let clock = Date.now();
    const relay = createRequestRelay({
      db: worker.db,
      enqueue,
      log: quiet,
      backoffMs: 1000,
      now: () => new Date(clock),
    });
    await relay.tick();
    expect(enqueue).toHaveBeenCalledTimes(1);
    await relay.tick(); // same instant: the row waits for its backoff
    expect(enqueue).toHaveBeenCalledTimes(1);
    clock += 1000;
    await relay.tick();
    expect(enqueue).toHaveBeenCalledTimes(2);
    clock += 1500; // the second wait is 2 s
    await relay.tick();
    expect(enqueue).toHaveBeenCalledTimes(2);
    clock += 600;
    await relay.tick();
    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(errors).toHaveBeenCalledTimes(3);
    expect(await mine([a.poolId])()).toHaveLength(1); // kept: nothing was lost
    // Past the give-up age the row goes, so a dead queue cannot grow the table.
    clock += 6 * 60_000;
    await relay.tick();
    expect(await mine([a.poolId])()).toEqual([]);
  });

  it('drops at once a request the queue can never accept (unknown job, refused payload)', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => jobRequestsRepo.request(tx, a.ctx, 'deposits.link'));
    await withPool(b.ctx, (tx) => jobRequestsRepo.request(tx, b.ctx, 'deposits.link'));
    const enqueue = vi.fn<Enqueue>((_name, payload) =>
      payload.poolId === a.poolId
        ? Promise.reject(new UnknownJobError())
        : Promise.reject(new ZodError([])),
    );
    const relay = createRequestRelay({ db: worker.db, enqueue, log });
    await relay.tick();
    expect(await mine([a.poolId, b.poolId])()).toEqual([]);
  });

  it('a request held by the dedupe window does not starve the ones behind it', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => jobRequestsRepo.request(tx, a.ctx, 'deposits.link'));
    await withPool(b.ctx, (tx) => jobRequestsRepo.request(tx, b.ctx, 'deposits.link'));
    const enqueue = vi.fn<Enqueue>((_name, payload) =>
      Promise.resolve(payload.poolId === a.poolId ? null : 'run'),
    );
    const relay = createRequestRelay({ db: worker.db, enqueue, log });
    await relay.tick();
    await relay.tick();
    // The held row is not retried in the same instant, and the other one went through.
    expect(enqueue.mock.calls.filter(([, p]) => p.poolId === a.poolId)).toHaveLength(1);
    expect((await mine([a.poolId, b.poolId])()).map((r) => r.poolId)).toEqual([a.poolId]);
  });

  it('dates a request from when it was made, not from the start of its transaction', async () => {
    const { a } = createTwoPools();
    const before = Date.now();
    await withPool(a.ctx, async (tx) => {
      await tx.execute(sql`select pg_sleep(0.5)`);
      await jobRequestsRepo.request(tx, a.ctx, 'deposits.link');
    });
    const [row] = await mine([a.poolId])();
    expect((row?.requestedAt.getTime() ?? 0) - before).toBeGreaterThanOrEqual(450);
    await jobRequestsRepo.settle(worker.db, row as PendingJobRequest);
  });

  it('start() schedules one timer and stop() leaves none, even when a pass is stuck', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => jobRequestsRepo.request(tx, a.ctx, 'deposits.link'));
    let release: (() => void) | undefined;
    const enqueue = vi.fn<Enqueue>(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve('run');
          };
        }),
    );
    const relay = createRequestRelay({
      db: worker.db,
      enqueue,
      log,
      intervalMs: 50,
      stopTimeoutMs: 200,
    });
    relay.start();
    relay.start(); // idempotent
    await vi.waitFor(() => {
      expect(enqueue).toHaveBeenCalled();
    });
    // The pass is stuck in the queue call: stop() waits its timeout and returns anyway.
    const started = Date.now();
    await relay.stop();
    expect(Date.now() - started).toBeLessThan(2000);
    enqueue.mockImplementation(() => Promise.resolve('run'));
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 300));
    // No new pass was scheduled after stop(): the stuck one ended and nothing called the queue again.
    const calls = enqueue.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(enqueue).toHaveBeenCalledTimes(calls);
    const rows = await mine([a.poolId])();
    await Promise.all(rows.map((r) => jobRequestsRepo.settle(worker.db, r)));
  });

  it('a request made while the worker was enqueueing is not lost', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => jobRequestsRepo.request(tx, a.ctx, 'deposits.link'));
    const [seen] = await mine([a.poolId])();
    await withPool(a.ctx, (tx) => jobRequestsRepo.request(tx, a.ctx, 'deposits.link'));
    await jobRequestsRepo.settle(worker.db, seen as PendingJobRequest);
    const left = await mine([a.poolId])();
    expect(left).toHaveLength(1);
    expect(left[0]?.token).not.toBe(seen?.token);
    await jobRequestsRepo.settle(worker.db, left[0] as PendingJobRequest);
  });
});
