import { describe, expect, it } from 'vitest';

import {
  createDepositsLinkJob,
  createPlansRemindJob,
  lisbonToday,
} from '../../apps/worker/src/jobs/pool-jobs';

const deps = { db: {} as never, withPool: {} as never };

describe('lisbonToday', () => {
  it('reads the day in Lisbon, not in UTC', () => {
    expect(lisbonToday(new Date('2026-06-10T10:00:00Z'))).toBe('2026-06-10');
    // 23:30 UTC in summer is already the next day in Lisbon (UTC+1).
    expect(lisbonToday(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01');
    // In winter Lisbon is on UTC.
    expect(lisbonToday(new Date('2026-12-31T23:30:00Z'))).toBe('2026-12-31');
  });
});

describe('pool jobs', () => {
  it('deposits.link sweeps hourly and accepts one pool', () => {
    const job = createDepositsLinkJob(deps);
    expect(job.name).toBe('deposits.link');
    expect(job.schedule).toEqual({ cron: '20 * * * *', data: {} });
    expect(() => {
      job.validate({});
    }).not.toThrow();
    expect(() => {
      job.validate({ poolId: '0199aaaa-0000-7000-8000-000000000001' });
    }).not.toThrow();
  });

  it('both jobs make one run per pool inside their window', () => {
    const pool = '0199aaaa-0000-7000-8000-000000000001';
    expect(createDepositsLinkJob(deps).singletonOf({ poolId: pool })).toEqual({
      key: pool,
      seconds: 60,
    });
    expect(createDepositsLinkJob(deps).singletonOf({})).toEqual({ key: 'all', seconds: 60 });
    expect(createPlansRemindJob(deps).singletonOf({})).toEqual({ key: 'all', seconds: 3600 });
  });

  it('plans.remind runs every day at 09:00', () => {
    const job = createPlansRemindJob(deps);
    expect(job.name).toBe('plans.remind');
    expect(job.schedule).toEqual({ cron: '0 9 * * *', data: {} });
  });

  it('refuses a payload that is not a pool id or has other fields', () => {
    for (const job of [createDepositsLinkJob(deps), createPlansRemindJob(deps)]) {
      expect(() => {
        job.validate({ poolId: 'not-a-uuid' });
      }).toThrow();
      expect(() => {
        job.validate({ poolId: "' OR 1=1 --" });
      }).toThrow();
      expect(() => {
        job.validate({ other: 1 });
      }).toThrow();
    }
  });
});
