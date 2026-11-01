import { jobRequestsRepo, type AppDb, type PendingJobRequest } from '@nestvault/db';
import type { Logger } from '@nestvault/services';
import { ZodError } from 'zod';

import { UnknownJobError } from './runtime';

export interface RequestRelayOptions {
  /** The worker's connection (`worker_rw`): reads and deletes the rows of `job_requests`. */
  db: Pick<AppDb, 'select' | 'delete'>;
  /** Asks the queue for a run; null when a run for the same pool is already inside its window. */
  enqueue: (name: string, payload: { poolId: string }) => Promise<string | null>;
  log: Logger;
  /** How often the table is looked at. Default 2 seconds. */
  intervalMs?: number;
  /** A request still not accepted after this long is dropped: the hourly sweep covers it. Default 5 minutes. */
  giveUpMs?: number;
  /** How long `stop()` waits for a pass in progress before it lets go of it. Default 5 seconds. */
  stopTimeoutMs?: number;
  /** First wait before a row that failed is tried again; doubles up to `maxBackoffMs`. Default 2 seconds. */
  backoffMs?: number;
  maxBackoffMs?: number;
  now?: () => Date;
}

export interface RequestRelay {
  /** One pass over the pending requests; returns how many became runs. */
  tick(): Promise<number>;
  start(): void;
  stop(): Promise<void>;
}

/** Rows read per pass. Rows waiting for their backoff are skipped, so a few held rows never starve the rest. */
const BATCH = 500;

/** A request that can never be accepted: waiting would only repeat the error. */
const isPermanent = (error: unknown) =>
  error instanceof UnknownJobError || error instanceof ZodError;

/**
 * Turns `job_requests` rows (written by the web app's transaction, NES-147) into queue runs, so an
 * import commit gets its deposits linked within seconds without the web bundle touching the queue.
 *
 * A row is deleted only after the queue accepted it (or after `giveUpMs`), and only if it was not
 * replaced by a newer request meanwhile, so no request is lost between the two.
 * - The queue already holds a run inside its dedupe window: the row stays (that run may have started
 *   before the import committed) and is looked at again after a short wait.
 * - Unknown job or refused payload: dropped at once, with one error log.
 * - Any other failure (queue down): kept, retried with a per-row exponential backoff, logged once per
 *   attempt, dropped after `giveUpMs`. The hourly sweep covers every dropped request.
 */
export function createRequestRelay({
  db,
  enqueue,
  log,
  intervalMs = 2000,
  giveUpMs = 5 * 60_000,
  stopTimeoutMs = 5000,
  backoffMs = 2000,
  maxBackoffMs = 60_000,
  now = () => new Date(),
}: RequestRelayOptions): RequestRelay {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<number> | undefined;
  /** Per row (pool, job, token): failures so far and when to try again. In memory only. */
  const waiting = new Map<string, { failures: number; notBefore: number }>();

  const keyOf = (request: PendingJobRequest) =>
    `${request.poolId}|${request.jobName}|${request.token}`;

  async function handle(request: PendingJobRequest): Promise<boolean> {
    const key = keyOf(request);
    const expired = now().getTime() - request.requestedAt.getTime() > giveUpMs;
    try {
      const runId = await enqueue(request.jobName, { poolId: request.poolId });
      if (runId !== null) {
        await jobRequestsRepo.settle(db, request);
        waiting.delete(key);
        return true;
      }
      if (expired) {
        await jobRequestsRepo.settle(db, request);
        waiting.delete(key);
        log.warn({ job: request.jobName }, 'job request dropped, the sweep covers it');
      } else {
        waiting.set(key, { failures: 0, notBefore: now().getTime() + intervalMs });
      }
      return false;
    } catch (error) {
      if (isPermanent(error) || expired) {
        log.error({ err: error, job: request.jobName }, 'job request dropped');
        await jobRequestsRepo.settle(db, request);
        waiting.delete(key);
        return false;
      }
      const failures = (waiting.get(key)?.failures ?? 0) + 1;
      const wait = Math.min(maxBackoffMs, backoffMs * 2 ** (failures - 1));
      waiting.set(key, { failures, notBefore: now().getTime() + wait });
      log.error({ err: error, job: request.jobName, failures }, 'job request failed, will retry');
      return false;
    }
  }

  async function tick(): Promise<number> {
    let enqueued = 0;
    const rows = await jobRequestsRepo.pending(db, BATCH);
    const live = new Set(rows.map(keyOf));
    for (const key of waiting.keys()) if (!live.has(key)) waiting.delete(key);
    for (const request of rows) {
      const hold = waiting.get(keyOf(request));
      if (hold && hold.notBefore > now().getTime()) continue;
      if (await handle(request)) enqueued += 1;
    }
    return enqueued;
  }

  function schedule(): void {
    timer = setTimeout(() => {
      running = tick()
        .catch((error: unknown) => {
          log.error({ err: error }, 'job request relay pass failed');
          return 0;
        })
        .finally(() => {
          running = undefined;
          if (timer) schedule();
        });
    }, intervalMs);
  }

  return {
    tick,
    start() {
      if (!timer) schedule();
    },
    async stop() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!running) return;
      // A pass stuck on a dead connection must not keep the worker from shutting down.
      let giveUp: NodeJS.Timeout | undefined;
      await Promise.race([
        running,
        new Promise<void>((resolve) => {
          giveUp = setTimeout(resolve, stopTimeoutMs);
        }),
      ]);
      clearTimeout(giveUp);
    },
  };
}
