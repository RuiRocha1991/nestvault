import { jobRequestsRepo, type AppDb, type PendingJobRequest } from '@nestvault/db';
import type { Logger } from '@nestvault/services';

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
  now?: () => Date;
}

export interface RequestRelay {
  /** One pass over the pending requests; returns how many became runs. */
  tick(): Promise<number>;
  start(): void;
  stop(): Promise<void>;
}

/**
 * Turns `job_requests` rows (written by the web app's transaction, NES-147) into queue runs, so an
 * import commit gets its deposits linked within seconds without the web bundle touching the queue.
 *
 * A row is deleted only after the queue accepted it (or after `giveUpMs`), and only if it was not
 * replaced by a newer request meanwhile, so no request is lost between the two. If the queue
 * already holds a run inside its dedupe window, the row stays for the next pass: that run may have
 * started before the import committed. Each job's payload is validated by the queue's own schema.
 */
export function createRequestRelay({
  db,
  enqueue,
  log,
  intervalMs = 2000,
  giveUpMs = 5 * 60_000,
  now = () => new Date(),
}: RequestRelayOptions): RequestRelay {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<number> | undefined;

  async function handle(request: PendingJobRequest): Promise<boolean> {
    const expired = now().getTime() - request.requestedAt.getTime() > giveUpMs;
    try {
      const runId = await enqueue(request.jobName, { poolId: request.poolId });
      if (runId === null && !expired) return false;
      await jobRequestsRepo.settle(db, request);
      if (runId === null) {
        log.warn({ job: request.jobName }, 'job request dropped, the sweep covers it');
      }
      return runId !== null;
    } catch (error) {
      // An unknown job or a refused payload does not get better by waiting.
      log.error({ err: error, job: request.jobName }, 'job request failed');
      if (expired) await jobRequestsRepo.settle(db, request);
      return false;
    }
  }

  async function tick(): Promise<number> {
    let enqueued = 0;
    for (const request of await jobRequestsRepo.pending(db)) {
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
      await running;
    },
  };
}
