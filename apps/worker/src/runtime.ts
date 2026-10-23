import { createLogger, type Logger } from '@nestvault/services';
import { PgBoss } from 'pg-boss';

import { SCHEDULE_TIME_ZONE, type Job } from './jobs/define';

/** Schema of the queues, installed by `pnpm db:migrate` (packages/db/src/migrate.ts). */
const JOB_SCHEMA = 'pgboss';

export interface WorkerOptions {
  /** Connection of `worker_rw` to the app database. */
  connectionString: string;
  jobs: readonly Job[];
  log?: Logger;
  /** Timings of the queue engine; the defaults suit production, tests shorten them. */
  tuning?: {
    /** How often an idle handler looks for work. Default 2. */
    pollSeconds?: number;
    /** How often runs past their expiry are found and retried. Default: pg-boss's own. */
    superviseSeconds?: number;
  };
}

export interface Worker {
  /** Starts the queues, the schedules and the handlers. */
  start(): Promise<void>;
  /** Asks for one run now. Returns the run id, or null when a singleton window already has it. */
  enqueue(name: string, payload?: object): Promise<string | null>;
  /** Waits up to `timeoutMs` for the runs in progress, then closes the connections. */
  stop(timeoutMs?: number): Promise<void>;
}

/**
 * The error a failed run is stored with. The real one only goes to the log (type, code and stack
 * frames): its message may carry query parameters, and the stored copy is readable by `worker:runs`.
 */
function storedError(error: unknown): Error {
  const name = error instanceof Error ? error.name : 'Error';
  return new Error(`${name}: the run failed, see the worker log`);
}

export function createWorker({
  connectionString,
  jobs,
  log = createLogger(),
  tuning = {},
}: WorkerOptions): Worker {
  const byName = new Map(jobs.map((job) => [job.name, job]));
  if (byName.size !== jobs.length) throw new Error('two jobs share a name');

  const boss = new PgBoss({
    connectionString,
    schema: JOB_SCHEMA,
    application_name: 'nestvault-worker',
    // The migrator owns installation and upgrades; the worker never changes the schema's shape.
    migrate: false,
    createSchema: false,
    ...(tuning.superviseSeconds === undefined
      ? {}
      : { superviseIntervalSeconds: tuning.superviseSeconds }),
  });
  boss.on('error', (error) => {
    log.error({ err: error }, 'queue error');
  });

  async function register(job: Job): Promise<void> {
    const queue = {
      retryLimit: job.retry.limit,
      retryDelay: job.retry.delaySeconds,
      retryBackoff: true,
      expireInSeconds: job.expireSeconds,
    };
    await boss.createQueue(job.name, queue);
    // createQueue leaves an existing queue alone, so a changed retry or expiry is applied here.
    await boss.updateQueue(job.name, queue);
    await boss.work<object>(
      job.name,
      { pollingIntervalSeconds: tuning.pollSeconds ?? 2 },
      async ([item]) => {
        if (!item) return;
        const runId = item.id;
        const attempt = item.retryCount + 1;
        const runLog = log.child({ job: job.name, run_id: runId, attempt });
        const started = performance.now();
        runLog.info('run started');
        try {
          await job.execute(item.data, { runId, jobName: job.name, attempt, log: runLog });
          runLog.info(
            { duration_ms: Math.round(performance.now() - started), outcome: 'ok' },
            'run finished',
          );
        } catch (error) {
          runLog.error(
            { err: error, duration_ms: Math.round(performance.now() - started), outcome: 'failed' },
            'run finished',
          );
          throw storedError(error);
        }
      },
    );
    if (job.schedule) {
      await boss.schedule(job.name, job.schedule.cron, job.schedule.data, {
        tz: SCHEDULE_TIME_ZONE,
      });
    }
  }

  /** Drops the schedule of a job that is no longer registered, so it stops queueing runs nobody handles. */
  async function removeOrphanSchedules(): Promise<void> {
    for (const { name, key } of await boss.getSchedules()) {
      if (byName.get(name)?.schedule) continue;
      await boss.unschedule(name, key);
      log.warn({ job: name }, 'removed a schedule of a job that is not registered');
    }
  }

  return {
    async start() {
      await boss.start();
      for (const job of jobs) await register(job);
      await removeOrphanSchedules();
      log.info({ jobs: jobs.map((job) => job.name) }, 'worker started');
    },
    async enqueue(name, payload = {}) {
      const job = byName.get(name);
      if (!job) throw new Error('unknown job');
      job.validate(payload);
      const singleton = job.singletonOf(payload);
      return boss.send(
        name,
        payload,
        singleton ? { singletonKey: singleton.key, singletonSeconds: singleton.seconds } : {},
      );
    },
    async stop(timeoutMs = 30_000) {
      await boss.stop({ graceful: true, timeout: timeoutMs });
      log.info('worker stopped');
    },
  };
}
