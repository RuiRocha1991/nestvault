import { Writable } from 'node:stream';

import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { testEnv } from '@nestvault/config/node';
import { createLogger } from '@nestvault/services';

import { defineJob, type Job } from '../../apps/worker/src/jobs/define';
import { samplePing } from '../../apps/worker/src/jobs/sample';
import { lastRuns } from '../../apps/worker/src/runs';
import { createWorker, type Worker } from '../../apps/worker/src/runtime';
import { openTestDatabase } from '../db/harness';

// Retries wait seconds (backoff) and the crash test waits for a run to expire.
vi.setConfig({ testTimeout: 40_000 });

const env = testEnv();
const database = openTestDatabase(1);
/** The worker's own connection: the same role the process runs with. */
const workerPool = new Pool({ connectionString: env.TEST_DATABASE_URL_WORKER, max: 2 });
const TUNING = { pollSeconds: 0.5, superviseSeconds: 1 };

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out waiting for the condition');
}

function captureLog() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      done();
    },
  });
  return { lines, log: createLogger({ destination }) };
}

const started: Worker[] = [];
async function startWorker(jobs: readonly Job[], log = createLogger({ level: 'silent' })) {
  const worker = createWorker({
    connectionString: env.TEST_DATABASE_URL_WORKER,
    jobs,
    log,
    tuning: TUNING,
  });
  await worker.start();
  started.push(worker);
  return worker;
}

beforeAll(async () => {
  await database.asMigrator((pool) =>
    pool.query(`
      DROP TABLE IF EXISTS _worker_effects;
      CREATE TABLE _worker_effects (effect_key text PRIMARY KEY, runs int NOT NULL DEFAULT 1);
    `),
  );
});

beforeEach(async () => {
  await workerPool.query("DELETE FROM pgboss.job WHERE name LIKE 'test.%' OR name = 'system.ping'");
  await workerPool.query(
    "DELETE FROM pgboss.schedule WHERE name LIKE 'test.%' OR name = 'system.ping'",
  );
  await database.asMigrator((pool) => pool.query('TRUNCATE _worker_effects'));
});

afterEach(async () => {
  await Promise.all(started.splice(0).map((worker) => worker.stop(1_000)));
});

afterAll(async () => {
  await database.asMigrator((pool) => pool.query('DROP TABLE IF EXISTS _worker_effects'));
  await workerPool.end();
  await database.close();
});

describe('worker runtime', () => {
  it('runs a job on demand and logs the run without the payload', async () => {
    const seen: string[] = [];
    const job = defineJob({
      name: 'test.ondemand',
      payload: z.object({ label: z.string() }).strict(),
      run: ({ label }) => {
        seen.push(label);
        return Promise.resolve();
      },
    });
    const { lines, log } = captureLog();
    const worker = await startWorker([job], log);

    const runId = await worker.enqueue('test.ondemand', { label: 'secret-looking-text' });
    expect(runId).toEqual(expect.any(String));
    await until(() => seen.length === 1);
    await until(() => lines.some((line) => line.msg === 'run finished'));

    const finished = lines.find((line) => line.msg === 'run finished');
    expect(finished).toMatchObject({ job: 'test.ondemand', run_id: runId, outcome: 'ok' });
    expect(finished?.duration_ms).toEqual(expect.any(Number));
    expect(JSON.stringify(lines)).not.toContain('secret-looking-text');
  });

  it('registers the schedule in Europe/Lisbon', async () => {
    await startWorker([samplePing]);
    const { rows } = await workerPool.query<{ cron: string; timezone: string }>(
      "SELECT cron, timezone FROM pgboss.schedule WHERE name = 'system.ping'",
    );
    expect(rows).toEqual([{ cron: '0 * * * *', timezone: 'Europe/Lisbon' }]);
  });

  it('removes the schedule of a job that is no longer registered', async () => {
    const first = await startWorker([samplePing]);
    await first.stop(1_000);
    started.length = 0;
    await startWorker([]);
    const { rows } = await workerPool.query(
      "SELECT 1 FROM pgboss.schedule WHERE name = 'system.ping'",
    );
    expect(rows).toEqual([]);
  });

  it('applies a changed retry policy to a queue that already exists', async () => {
    const make = (limit: number, expireSeconds: number) =>
      defineJob({
        name: 'test.policy',
        payload: z.object({}).strict(),
        retry: { limit, delaySeconds: 5 },
        expireSeconds,
        run: () => Promise.resolve(),
      });
    const first = await startWorker([make(1, 60)]);
    await first.stop(1_000);
    started.length = 0;
    await startWorker([make(4, 120)]);
    const { rows } = await workerPool.query<{ retry_limit: number; expire_seconds: number }>(
      "SELECT retry_limit, expire_seconds FROM pgboss.queue WHERE name = 'test.policy'",
    );
    expect(rows).toEqual([{ retry_limit: 4, expire_seconds: 120 }]);
  });

  it('refuses a payload the job did not declare, without queueing anything', async () => {
    const worker = await startWorker([samplePing]);
    await expect(worker.enqueue('system.ping', { label: 1 })).rejects.toThrow();
    await expect(worker.enqueue('system.ping', { label: 'x', extra: 1 })).rejects.toThrow();
    await expect(worker.enqueue('test.unknown')).rejects.toThrow('unknown job');
    const { rows } = await workerPool.query("SELECT 1 FROM pgboss.job WHERE name = 'system.ping'");
    expect(rows).toEqual([]);
  });

  it('makes one run for two requests with the same singleton key', async () => {
    const job = defineJob({
      name: 'test.singleton',
      payload: z.object({ key: z.string() }).strict(),
      singleton: { key: ({ key }) => key, dedupeSeconds: 60 },
      run: () => Promise.resolve(),
    });
    const worker = await startWorker([job]);
    const first = await worker.enqueue('test.singleton', { key: 'k1' });
    const second = await worker.enqueue('test.singleton', { key: 'k1' });
    const other = await worker.enqueue('test.singleton', { key: 'k2' });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(other).not.toBeNull();
  });

  it('retries a failing job, then marks it failed and logs the error without its message', async () => {
    let tries = 0;
    const job = defineJob({
      name: 'test.failing',
      payload: z.object({}).strict(),
      retry: { limit: 2, delaySeconds: 1 },
      run: () => {
        tries += 1;
        return Promise.reject(new Error('password=hunter2 leaked into a message'));
      },
    });
    const { lines, log } = captureLog();
    const worker = await startWorker([job], log);
    await worker.enqueue('test.failing', {});

    await until(async () => {
      const runs = await lastRuns(workerPool, { limit: 5, failedOnly: true });
      return runs.some((run) => run.job === 'test.failing');
    });
    expect(tries).toBe(3);

    const [run] = await lastRuns(workerPool, { limit: 1, failedOnly: true });
    expect(run).toMatchObject({ job: 'test.failing', state: 'failed', attempts: 3 });
    expect(run?.error).toBe('Error: the run failed, see the worker log');

    const failures = lines.filter(
      (line) => line.msg === 'run finished' && line.outcome === 'failed',
    );
    expect(failures).toHaveLength(3);
    expect(failures[0]?.err).toMatchObject({ type: 'Error' });
    expect(JSON.stringify([lines, run])).not.toContain('hunter2');
  });

  it('does not duplicate the effect when the worker dies mid-job and another one finishes it', async () => {
    let entered = 0;
    const effectKey = 'once';
    const job = defineJob({
      name: 'test.crash',
      payload: z.object({}).strict(),
      expireSeconds: 1,
      retry: { limit: 3, delaySeconds: 1 },
      run: async () => {
        entered += 1;
        // The effect is keyed by the work, so doing it twice changes nothing.
        await workerPool.query(
          'INSERT INTO _worker_effects (effect_key) VALUES ($1) ON CONFLICT (effect_key) DO UPDATE SET runs = _worker_effects.runs',
          [effectKey],
        );
        if (entered === 1) await new Promise(() => undefined); // "killed" here, never returns
      },
    });

    const first = await startWorker([job]);
    await first.enqueue('test.crash', {});
    await until(() => entered === 1);
    await first.stop(300); // gives up on the hung run: the process is gone as far as the queue knows

    await startWorker([job]);
    await until(async () => {
      const [run] = await lastRuns(workerPool, { limit: 1 });
      return run?.job === 'test.crash' && run.state === 'completed';
    });

    expect(entered).toBe(2);
    const { rows } = await workerPool.query<{ n: string }>(
      'SELECT count(*) AS n FROM _worker_effects',
    );
    expect(rows[0]?.n).toBe('1');
  });
});
