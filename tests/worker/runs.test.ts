import { describe, expect, it } from 'vitest';

import { formatRuns, lastRuns } from '../../apps/worker/src/runs';

describe('formatRuns', () => {
  it('says so when there are no runs', () => {
    expect(formatRuns([])).toBe('No runs yet.');
  });

  it('prints one line per run with state, job, duration, attempts and the stored error', () => {
    const text = formatRuns([
      {
        job: 'fx.refresh',
        state: 'failed',
        attempts: 4,
        createdOn: new Date('2026-10-23T17:00:00.000Z'),
        durationMs: 1200,
        error: 'Error: the run failed, see the worker log',
      },
      {
        job: 'system.ping',
        state: 'completed',
        attempts: 1,
        createdOn: new Date('2026-10-23T16:00:00.000Z'),
        durationMs: null,
        error: null,
      },
    ]);
    const [failed, ok] = text.split('\n');
    expect(failed).toContain('failed');
    expect(failed).toContain('fx.refresh');
    expect(failed).toContain('1200 ms');
    expect(failed).toContain('try 4');
    expect(failed).toContain('see the worker log');
    expect(ok).toContain('- ms');
  });
});

describe('lastRuns', () => {
  it('binds the limit and the filter, and clamps the limit', async () => {
    const calls: unknown[][] = [];
    const pool = {
      query: (text: string, values: unknown[]) => {
        calls.push([text, values]);
        return Promise.resolve({ rows: [] });
      },
    };
    await lastRuns(pool as never, { limit: 100000 });
    await lastRuns(pool as never, { limit: -3, failedOnly: true });
    expect(calls.map((call) => call[1])).toEqual([
      [500, false],
      [1, true],
    ]);
    // Values reach the database as parameters, never inside the SQL text.
    expect(String(calls[0]?.[0])).not.toContain('500');
  });
});
