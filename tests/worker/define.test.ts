import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineJob, DEFAULT_RETRY } from '../../apps/worker/src/jobs/define';
import { createProductionJobs } from '../../apps/worker/src/jobs/registry';
import { samplePing } from '../../apps/worker/src/jobs/sample';

const payload = z.object({ n: z.number().int() }).strict();

describe('defineJob', () => {
  it('rejects a name that is not area.action', () => {
    for (const name of ['ping', 'Fx.Refresh', 'fx.', 'fx refresh']) {
      expect(() => defineJob({ name, payload, run: () => Promise.resolve() })).toThrow(TypeError);
    }
  });

  it('refuses a payload the schema does not accept, before the handler runs', async () => {
    let ran = false;
    const job = defineJob({
      name: 'test.strict',
      payload,
      run: () => {
        ran = true;
        return Promise.resolve();
      },
    });
    const info = { runId: 'r', jobName: 'test.strict', attempt: 1, log: undefined as never };
    await expect(job.execute({ n: 1, extra: true }, info)).rejects.toThrow();
    await expect(job.execute({ n: 'x' }, info)).rejects.toThrow();
    expect(ran).toBe(false);
    await job.execute({ n: 1 }, info);
    expect(ran).toBe(true);
  });

  it('fails at definition when the scheduled payload is not valid', () => {
    expect(() =>
      defineJob({
        name: 'test.badschedule',
        payload,
        schedule: { cron: '0 3 * * *', data: { n: 'x' as unknown as number } },
        run: () => Promise.resolve(),
      }),
    ).toThrow();
  });

  it('uses the default retry policy and 15 minutes of expiry', () => {
    const job = defineJob({ name: 'test.defaults', payload, run: () => Promise.resolve() });
    expect(job.retry).toEqual(DEFAULT_RETRY);
    expect(job.expireSeconds).toBe(900);
    expect(job.schedule).toBeNull();
  });

  it('derives the singleton key from the validated payload', () => {
    const job = defineJob({
      name: 'test.singleton',
      payload,
      singleton: { key: (p) => `n-${String(p.n)}`, dedupeSeconds: 60 },
      run: () => Promise.resolve(),
    });
    expect(job.singletonOf({ n: 7 })).toEqual({ key: 'n-7', seconds: 60 });
    expect(() => job.singletonOf({ n: 'x' })).toThrow();
  });
});

// The registry only needs the connection to build the jobs; nothing runs here.
const PRODUCTION_JOBS = createProductionJobs({ db: {} as never });

describe('registry', () => {
  it('keeps the sample job out of the production registry', () => {
    expect(PRODUCTION_JOBS.map((job) => job.name)).not.toContain(samplePing.name);
  });

  it('has unique job names', () => {
    const names = PRODUCTION_JOBS.map((job) => job.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
