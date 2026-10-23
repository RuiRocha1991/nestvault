import type { Logger } from '@nestvault/services';
import type { z } from 'zod';

/** The one time zone every schedule is written in (PRD 05). */
export const SCHEDULE_TIME_ZONE = 'Europe/Lisbon';

/** What a handler gets besides its payload: ids for the logs and a logger already carrying them. */
export interface RunInfo {
  runId: string;
  jobName: string;
  /** 1 for the first try, 2 for the first retry, ... */
  attempt: number;
  log: Logger;
}

export interface RetryPolicy {
  /** Retries after the first try. */
  limit: number;
  /** Seconds before the first retry; doubles on each one (exponential backoff). */
  delaySeconds: number;
}

export interface JobDefinition<S extends z.ZodType> {
  /** `area.action`, for example `fx.refresh`. It is the queue name. */
  name: string;
  /** The payload is parsed with this before the handler runs; the schema should be `.strict()`. */
  payload: S;
  /** Cron expression read in Europe/Lisbon, and the payload each run gets. */
  schedule?: { cron: string; data: z.input<S> };
  retry?: RetryPolicy;
  /** A run still active after this long is treated as crashed and retried. Default 15 minutes. */
  expireSeconds?: number;
  /**
   * Two requests with the same key inside `dedupeSeconds` make one run. Without it every request
   * runs. The handler must still be idempotent: a crash retries the same run.
   */
  singleton?: { key: (payload: z.output<S>) => string; dedupeSeconds: number };
  run: (payload: z.output<S>, info: RunInfo) => Promise<void>;
}

/** A job as the runtime sees it: payloads are `unknown` until `execute` validates them. */
export interface Job {
  readonly name: string;
  readonly schedule: { readonly cron: string; readonly data: object } | null;
  readonly retry: RetryPolicy;
  readonly expireSeconds: number;
  /** Validates `raw` and returns the singleton key and window, or null when the job has none. */
  singletonOf(raw: unknown): { key: string; seconds: number } | null;
  /** Throws a ZodError when the payload is not the one the job declared. */
  validate(raw: unknown): void;
  execute(raw: unknown, info: RunInfo): Promise<void>;
}

const NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

export const DEFAULT_RETRY: RetryPolicy = { limit: 3, delaySeconds: 30 };
export const DEFAULT_EXPIRE_SECONDS = 15 * 60;

export function defineJob<S extends z.ZodType>(definition: JobDefinition<S>): Job {
  if (!NAME.test(definition.name)) throw new TypeError('a job name is like `area.action`');
  const parse = (raw: unknown): z.output<S> => definition.payload.parse(raw);
  // A schedule with a payload the job would refuse must fail at start-up, not at three in the night.
  const scheduled = definition.schedule
    ? { cron: definition.schedule.cron, data: parse(definition.schedule.data) as object }
    : null;
  return {
    name: definition.name,
    schedule: scheduled,
    retry: definition.retry ?? DEFAULT_RETRY,
    expireSeconds: definition.expireSeconds ?? DEFAULT_EXPIRE_SECONDS,
    singletonOf(raw) {
      if (!definition.singleton) return null;
      return {
        key: definition.singleton.key(parse(raw)),
        seconds: definition.singleton.dedupeSeconds,
      };
    },
    validate(raw) {
      parse(raw);
    },
    execute: async (raw, info) => {
      await definition.run(parse(raw), info);
    },
  };
}
