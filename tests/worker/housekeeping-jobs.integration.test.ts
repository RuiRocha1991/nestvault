import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { parseKeyRing } from '@nestvault/crypto';
import { importBatchesRepo, netWorthSnapshotsRepo, newId } from '@nestvault/db';
import { createEncryptedFileStore, createLogger, systemContext } from '@nestvault/services';

import { createWorkerPoolRunner } from '../../apps/worker/src/database';
import { createSessionsCleanupJob } from '../../apps/worker/src/jobs/sessions-cleanup';
import { createSnapshotsDailyJob } from '../../apps/worker/src/jobs/snapshots-daily';
import { lisbonDay } from '../../apps/worker/src/jobs/tenant';
import { createApiWorld, type ApiWorld, type Scenario } from '../support/api-world';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;
let storageDir: string;

const log = createLogger({ level: 'silent' });
const info = (jobName: string) => ({ runId: 'run', jobName, attempt: 1, log });
// The worker's own connection: the role the process runs with (no BYPASSRLS).
const run = createWorkerPoolRunner(testEnv().TEST_DATABASE_URL_WORKER);
const NOW = new Date('2026-10-31T22:30:00Z');
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  world = await createApiWorld();
});

beforeEach(async () => {
  s = await world.newScenario();
  storageDir = await mkdtemp(join(tmpdir(), 'nv-worker-'));
});

afterEach(async () => {
  await rm(storageDir, { recursive: true, force: true });
});

afterAll(async () => {
  await world.close();
});

const deps = () => ({ identity: world.identity, run, storageDir, now: () => NOW });
const ids = (poolId: string) => {
  const ctx = systemContext(poolId, ['pool.read']);
  return run(ctx, (tx) => netWorthSnapshotsRepo.listBetween(tx, ctx, '2000-01-01', '2100-01-01'));
};

describe('lisbonDay', () => {
  it('is the calendar day in Lisbon, also across midnight and the summer offset', () => {
    expect(lisbonDay(new Date('2026-10-31T22:30:00Z'))).toBe('2026-10-31');
    expect(lisbonDay(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02');
    expect(lisbonDay(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-15');
  });
});

describe('snapshots.daily', () => {
  it('is scheduled at 23:30 and stores one snapshot per pool as the worker role', async () => {
    const job = createSnapshotsDailyJob(deps());
    expect(job.name).toBe('snapshots.daily');
    expect(job.schedule?.cron).toBe('30 23 * * *');

    const owner = await s.as('owner');
    const holder = (await world.holders.list(owner, s.poolA)).holders[0]?.id ?? '';
    await world.accounts.create(owner, s.poolA, {
      type: 'checking',
      name: 'Conta',
      currency: 'EUR',
      holderIds: [holder],
      opening: '750',
      openingDate: '2026-01-01',
    });

    await job.execute({}, info(job.name));
    await job.execute({}, info(job.name)); // a retry or a second run changes nothing

    const [a, b] = [await ids(s.poolA), await ids(s.poolB)];
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ date: '2026-10-31', net: '750.0000' });
    expect(b).toEqual([expect.objectContaining({ date: '2026-10-31', net: '0.0000' })]);
  });

  it('rejects a payload it does not declare', () => {
    expect(() => {
      createSnapshotsDailyJob(deps()).validate({ poolId: 'x' });
    }).toThrow();
  });
});

describe('sessions.cleanup', () => {
  const insertSession = async (expiresAt: Date) => {
    const id = newId();
    await world.identity.db.execute(
      sql`insert into session (id, user_id, token, expires_at, created_at, updated_at)
          values (${id}, ${s.ids.owner}, ${`hash-${id}`}, ${expiresAt}, now(), now())`,
    );
    return id;
  };

  it('is scheduled daily and never deletes an active session', async () => {
    const job = createSessionsCleanupJob(deps());
    expect(job.name).toBe('sessions.cleanup');
    expect(job.schedule?.cron).toBe('15 4 * * *');

    const active = await insertSession(new Date(NOW.getTime() + DAY));
    const expired = await insertSession(new Date(NOW.getTime() - DAY));
    await job.execute({}, info(job.name));
    const left = (await world.identity.db.execute(sql`select id from session`)).rows.map(
      (row) => row.id,
    );
    expect(left).toContain(active);
    expect(left).not.toContain(expired);
  });

  it('removes the file of a discarded preview from disk and keeps a file still in use', async () => {
    const store = createEncryptedFileStore({
      dir: storageDir,
      ring: parseKeyRing(Buffer.alloc(32, 5).toString('base64')),
    });
    const [gone, kept] = ['1', '2'].map((c) => c.repeat(64)) as [string, string];
    await store.put(s.poolA, gone, Buffer.from('discarded statement'));
    await store.put(s.poolA, kept, Buffer.from('committed statement'));

    const ctx = systemContext(s.poolA, ['imports.run']);
    const values = (fileSha256: string) => ({
      kind: 'bank' as const,
      fileName: 'extrato.csv',
      fileSha256,
      sizeBytes: 10,
      rowCount: 1,
      parserId: 'generic',
      parserKind: 'bank' as const,
      parserVersion: '1',
      confidence: '0.9',
      reconciled: null,
      accountId: null,
      preview: [],
      spec: null,
    });
    await run(ctx, async (tx) => {
      const old = new Date(NOW.getTime() - 20 * DAY);
      for (const sha of [gone, kept]) {
        const id = newId();
        await importBatchesRepo.insert(tx, ctx, id, values(sha), s.ids.owner);
        await importBatchesRepo.markDiscarded(tx, ctx, id, old);
      }
      // `kept` is also the file of a batch that is still a preview.
      await importBatchesRepo.insert(tx, ctx, newId(), values(kept), s.ids.owner);
    });

    const job = createSessionsCleanupJob(deps());
    await job.execute({}, info(job.name));
    expect(await readdir(join(storageDir, s.poolA))).toEqual([`${kept}.bin`]);
  });
});
