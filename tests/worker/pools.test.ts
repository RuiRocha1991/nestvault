import { describe, expect, it } from 'vitest';

import { createLogger } from '@nestvault/services';

import { forEachPool } from '../../apps/worker/src/pools';
import { createPool } from '../support/factories';

const log = createLogger({ level: 'silent' });

describe('forEachPool', () => {
  it('opens one system context per pool with exactly the permissions it was given', async () => {
    const [a, b] = [createPool().poolId, createPool().poolId];
    const seen: { poolId: string; permissions: string[]; actor: string }[] = [];
    await forEachPool([a, b], ['accounts.write'], log, (ctx) => {
      seen.push({ poolId: ctx.poolId, permissions: [...ctx.permissions], actor: ctx.actor.kind });
      return Promise.resolve();
    });
    expect(seen).toEqual([
      { poolId: a, permissions: ['accounts.write'], actor: 'system' },
      { poolId: b, permissions: ['accounts.write'], actor: 'system' },
    ]);
  });

  it('keeps going after a pool fails, then throws so the job is retried', async () => {
    const [a, b, c] = [createPool().poolId, createPool().poolId, createPool().poolId];
    const done: string[] = [];
    await expect(
      forEachPool([a, b, c], [], log, (ctx) => {
        if (ctx.poolId === b) return Promise.reject(new Error('boom'));
        done.push(ctx.poolId);
        return Promise.resolve();
      }),
    ).rejects.toThrow('1 of 3 pools failed');
    expect(done).toEqual([a, c]);
  });

  it('refuses an id that is not a pool id', async () => {
    await expect(forEachPool(['not-a-uuid'], [], log, () => Promise.resolve())).rejects.toThrow(
      '1 of 1 pools failed',
    );
  });
});
