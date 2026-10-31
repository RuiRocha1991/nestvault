import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { importBatchesRepo, newId } from '@nestvault/db';
import {
  cleanIdentity,
  cleanImportPreviews,
  ForbiddenError,
  IdentityCleanupError,
  logger,
  systemContext,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Scenario } from '../support/api-world';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;

const NOW = new Date('2026-10-31T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

beforeAll(async () => {
  logger.level = 'silent';
  world = await createApiWorld();
});

beforeEach(async () => {
  s = await world.newScenario();
});

afterAll(async () => {
  await world.close();
});

const db = () => world.identity.db;
const SELECTS = {
  session: sql`select * from session`,
  invites: sql`select * from invites`,
  rate_limits: sql`select * from rate_limits`,
};
const rows = async (table: keyof typeof SELECTS): Promise<Record<string, unknown>[]> =>
  (await db().execute(SELECTS[table])).rows;

async function insertSession(userId: string, expiresAt: Date): Promise<string> {
  const id = newId();
  await db().execute(
    sql`insert into session (id, user_id, token, expires_at, created_at, updated_at)
        values (${id}, ${userId}, ${`hash-${id}`}, ${expiresAt}, now(), now())`,
  );
  return id;
}

async function insertInvite(options: {
  expiresAt: Date;
  acceptedAt?: Date;
  email: string;
}): Promise<string> {
  const id = newId();
  await db().execute(
    sql`insert into invites (id, pool_id, email, role, token_hash, expires_at, accepted_at)
        values (${id}, ${s.poolA}, ${options.email}, 'member', ${`hash-${id}`},
                ${options.expiresAt}, ${options.acceptedAt ?? null})`,
  );
  return id;
}

describe('cleanIdentity', () => {
  it('deletes expired sessions and never an active one', async () => {
    const owner = s.ids.owner;
    // The personas signed in by the scenario hold real sessions that have not expired.
    await s.as('owner');
    const real = await s.sessionIds('owner');
    expect(real.length).toBeGreaterThan(0);
    const at = world.now();
    const inMs = (ms: number) => new Date(at.getTime() + ms);
    const active = await insertSession(owner, inMs(DAY));
    const justActive = await insertSession(owner, inMs(1000));
    const expired = await insertSession(owner, inMs(-DAY));
    const longExpired = await insertSession(owner, inMs(-90 * DAY));

    const result = await cleanIdentity(world.identity, at);
    expect(result.sessions).toBe(2);

    const left = (await rows('session')).map((row) => row.id);
    expect(left).toEqual(expect.arrayContaining([active, justActive, ...real]));
    expect(left).not.toContain(expired);
    expect(left).not.toContain(longExpired);
  });

  it('deletes invites that ended more than 30 days ago and keeps the ones still usable', async () => {
    const usable = await insertInvite({
      expiresAt: new Date(NOW.getTime() + DAY),
      email: 'a@example.test',
    });
    const recentlyExpired = await insertInvite({ expiresAt: ago(5), email: 'b@example.test' });
    const oldExpired = await insertInvite({ expiresAt: ago(45), email: 'c@example.test' });
    const recentlyUsed = await insertInvite({
      expiresAt: ago(10),
      acceptedAt: ago(12),
      email: 'd@example.test',
    });
    const oldUsed = await insertInvite({
      expiresAt: ago(60),
      acceptedAt: ago(70),
      email: 'e@example.test',
    });

    const result = await cleanIdentity(world.identity, NOW);
    expect(result.invites).toBe(2);
    const left = (await rows('invites')).map((row) => row.id);
    expect(left).toEqual(expect.arrayContaining([usable, recentlyExpired, recentlyUsed]));
    expect(left).not.toContain(oldExpired);
    expect(left).not.toContain(oldUsed);
  });

  it('deletes rate-limit windows that have ended and keeps the current ones', async () => {
    await db().execute(
      sql`insert into rate_limits (bucket, key_hash, window_start, count, expires_at) values
          ('login', 'old', ${ago(2)}, 3, ${ago(1)}),
          ('login', 'now', ${NOW}, 1, ${new Date(NOW.getTime() + 60_000)})`,
    );
    const result = await cleanIdentity(world.identity, NOW);
    expect(result.rateWindows).toBe(1);
    expect((await rows('rate_limits')).map((row) => row.key_hash)).toEqual(['now']);
  });

  it('runs every step even when one fails, then reports which failed', async () => {
    const owner = s.ids.owner;
    const expired = await insertSession(owner, ago(3));
    const oldInvite = await insertInvite({ expiresAt: ago(45), email: 'f@example.test' });
    // The first delete (the sessions) fails; the invites and the rate limits must still be cleaned.
    let first = true;
    const flaky = {
      db: new Proxy(db(), {
        get(target, property) {
          if (property === 'delete' && first) {
            first = false;
            return () => {
              throw new Error('connection reset with a secret value');
            };
          }
          return Reflect.get(target, property, target) as unknown;
        },
      }),
    };
    const failure = await cleanIdentity(flaky, NOW).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(IdentityCleanupError);
    expect((failure as IdentityCleanupError).failures).toEqual(['sessions']);
    expect((failure as IdentityCleanupError).message).not.toContain('secret');
    expect((failure as IdentityCleanupError).done.invites).toBe(1);
    expect((await rows('session')).map((row) => row.id)).toContain(expired);
    expect((await rows('invites')).map((row) => row.id)).not.toContain(oldInvite);
  });

  it('is idempotent: a second run finds nothing', async () => {
    await insertSession(s.ids.owner, ago(3));
    await cleanIdentity(world.identity, NOW);
    expect(await cleanIdentity(world.identity, NOW)).toEqual({
      sessions: 0,
      invites: 0,
      rateWindows: 0,
    });
  });
});

describe('cleanImportPreviews', () => {
  let removed: [string, string][];
  const remove = (poolId: string, sha: string) => {
    removed.push([poolId, sha]);
    return Promise.resolve();
  };
  const ctxOf = (poolId: string) => systemContext(poolId, ['imports.run']);
  const run = () => world.database.withPool;
  const values = (sha: string) => ({
    kind: 'bank' as const,
    fileName: 'extrato.csv',
    fileSha256: sha,
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
  /** A batch of the pool in the given state, last touched `daysAgo` days before NOW. */
  async function batch(
    poolId: string,
    sha: string,
    status: 'preview' | 'discarded',
    daysAgo: number,
  ) {
    const ctx = ctxOf(poolId);
    const id = newId();
    await run()(ctx, async (tx) => {
      await importBatchesRepo.insert(tx, ctx, id, values(sha), s.ids.owner);
      if (status === 'discarded') await importBatchesRepo.markDiscarded(tx, ctx, id, ago(daysAgo));
    });
    return id;
  }
  const remaining = (poolId: string) =>
    run()(ctxOf(poolId), async (tx) => {
      const ctx = ctxOf(poolId);
      return (
        await importBatchesRepo.hashesInUse(tx, ctx, [
          'a'.repeat(64),
          'b'.repeat(64),
          'c'.repeat(64),
        ])
      ).sort();
    });

  beforeEach(() => {
    removed = [];
  });

  it('removes old discarded batches and their files, keeping recent, pending and shared ones', async () => {
    const [old, recent, pending, shared] = ['a', 'b', 'c', 'd'].map((c) => c.repeat(64)) as [
      string,
      string,
      string,
      string,
    ];
    await batch(s.poolA, old, 'discarded', 20);
    await batch(s.poolA, recent, 'discarded', 2);
    await batch(s.poolA, pending, 'preview', 40);
    // The same file discarded long ago and still pending in another batch: the file must stay.
    await batch(s.poolA, shared, 'discarded', 20);
    await batch(s.poolA, shared, 'preview', 1);

    const result = await cleanImportPreviews(ctxOf(s.poolA), NOW, remove, run());
    expect(result).toEqual({ batches: 2, files: 1, failed: 0 });
    expect(removed).toEqual([[s.poolA, old]]);
    expect(await remaining(s.poolA)).toEqual(['b'.repeat(64), 'c'.repeat(64)]);
  });

  it('only looks at its own pool', async () => {
    const sha = 'a'.repeat(64);
    await batch(s.poolB, sha, 'discarded', 30);
    const result = await cleanImportPreviews(ctxOf(s.poolA), NOW, remove, run());
    expect(result).toEqual({ batches: 0, files: 0, failed: 0 });
    expect(removed).toEqual([]);
    expect(await cleanImportPreviews(ctxOf(s.poolB), NOW, remove, run())).toEqual({
      batches: 1,
      files: 1,
      failed: 0,
    });
  });

  it('looks hashes up as data: an injection payload matches nothing', async () => {
    await batch(s.poolA, 'a'.repeat(64), 'preview', 1);
    const ctx = ctxOf(s.poolA);
    const found = await run()(ctx, (tx) =>
      importBatchesRepo.hashesInUse(tx, ctx, ["' OR 1=1 --", "'; DROP TABLE import_batches; --"]),
    );
    expect(found).toEqual([]);
    expect(await remaining(s.poolA)).toEqual(['a'.repeat(64)]);
  });

  it('counts a failing removal and still removes the next file', async () => {
    const [bad, good] = ['a', 'b'].map((c) => c.repeat(64)) as [string, string];
    await batch(s.poolA, bad, 'discarded', 20);
    await batch(s.poolA, good, 'discarded', 20);
    const attempted: string[] = [];
    const result = await cleanImportPreviews(
      ctxOf(s.poolA),
      NOW,
      (poolId, sha) => {
        attempted.push(sha);
        return sha === bad
          ? Promise.reject(new Error(`EACCES /secret/${poolId}/${sha}`))
          : Promise.resolve();
      },
      run(),
    );
    expect(attempted.sort()).toEqual([bad, good]);
    expect(result).toEqual({ batches: 2, files: 1, failed: 1 });
  });

  it('keeps a file whose hash a new batch took up just before the removal', async () => {
    const sha = 'a'.repeat(64);
    await batch(s.poolA, sha, 'discarded', 20);
    let calls = 0;
    // The same statement is uploaded again between the first check and the removal.
    const racing: typeof run extends () => infer R ? R : never = (ctx, work) =>
      run()(ctx, async (tx) => {
        calls += 1;
        if (calls === 2) await importBatchesRepo.insert(tx, ctx, newId(), values(sha), s.ids.owner);
        return work(tx);
      });
    const removed: string[] = [];
    const result = await cleanImportPreviews(
      ctxOf(s.poolA),
      NOW,
      (_pool, hash) => {
        removed.push(hash);
        return Promise.resolve();
      },
      racing,
    );
    expect(removed).toEqual([]);
    expect(result).toEqual({ batches: 1, files: 0, failed: 0 });
  });

  it('needs imports.run', async () => {
    await expect(
      cleanImportPreviews(systemContext(s.poolA, ['pool.read']), NOW, remove, run()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
