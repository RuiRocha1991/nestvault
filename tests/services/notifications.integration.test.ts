import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  logger,
  NotFoundError,
  NotificationListDto,
  UnauthorizedError,
  ValidationError,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Scenario } from '../support/api-world';
import { notificationIn } from '../support/route-registry';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;

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

const list = async (persona: Parameters<Scenario['as']>[0], query: unknown = {}, pool = s.poolA) =>
  world.notifications.list(await s.as(persona), pool, query);

describe('list', () => {
  it('lists the open notifications of the pool with the caller’s own read state', async () => {
    const march = await notificationIn(s, 'A', '2026-03');
    const april = await notificationIn(s, 'A', '2026-04');

    const seen = await list('owner');
    expect(NotificationListDto.strict().safeParse(seen).success).toBe(true);
    expect(seen.unreadCount).toBe(2);
    expect(seen.notifications.map((n) => n.id).sort()).toEqual([april.id, march.id].sort());
    const first = seen.notifications[0];
    expect(Object.keys(first ?? {}).sort()).toEqual(
      ['createdAt', 'id', 'kind', 'period', 'planId', 'read'].sort(),
    );
    expect(first).toMatchObject({ kind: 'plan_reminder', planId: march.planId, read: false });
    expect(first?.period).toMatch(/^2026-0[34]$/);
  });

  it('keeps the read state per user and filters by status', async () => {
    const one = await notificationIn(s, 'A', '2026-03');
    await notificationIn(s, 'A', '2026-04');
    await world.notifications.markRead(await s.as('owner'), s.poolA, one.id);

    const mine = await list('owner');
    expect(mine.unreadCount).toBe(1);
    expect(mine.notifications.filter((n) => n.read).map((n) => n.id)).toEqual([one.id]);
    const unread = await list('owner', { status: 'unread' });
    expect(unread.notifications).toHaveLength(1);
    expect(unread.unreadCount).toBe(1);

    const theirs = await list('member');
    expect(theirs.unreadCount).toBe(2);
    expect(theirs.notifications.every((n) => !n.read)).toBe(true);
  });

  it('never shows another pool’s notifications', async () => {
    await notificationIn(s, 'A');
    const b = await notificationIn(s, 'B');
    const seen = await list('owner');
    expect(seen.notifications.map((n) => n.id)).not.toContain(b.id);
    expect(JSON.stringify(seen)).not.toContain(b.planId);
    expect((await list('outsider', {}, s.poolB)).notifications.map((n) => n.id)).toEqual([b.id]);
  });

  it('answers 404 to a non-member and 401 without a session', async () => {
    await notificationIn(s, 'A');
    await expect(list('outsider')).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.notifications.list(new Headers(), s.poolA, {})).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('lets a viewer read (pool.read is the only permission, nothing is denied by role)', async () => {
    await notificationIn(s, 'A');
    expect((await list('viewer')).unreadCount).toBe(1);
  });

  it('rejects an unknown status, extra parameters and injection payloads', async () => {
    for (const query of [
      { status: 'everything' },
      { status: "' OR 1=1 --" },
      { status: 'unread', poolId: s.poolB },
      { limit: '5' },
    ]) {
      await expect(list('owner', query)).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describe('markRead', () => {
  it('marks one notification for the caller only and is idempotent', async () => {
    const one = await notificationIn(s, 'A');
    const owner = await s.as('owner');
    await world.notifications.markRead(owner, s.poolA, one.id);
    await world.notifications.markRead(owner, s.poolA, one.id.toUpperCase());
    expect((await list('owner')).unreadCount).toBe(0);
    expect((await list('admin')).unreadCount).toBe(1);
    expect((await list('viewer')).unreadCount).toBe(1);
  });

  it('lets a viewer keep their own read state', async () => {
    const one = await notificationIn(s, 'A');
    await world.notifications.markRead(await s.as('viewer'), s.poolA, one.id);
    expect((await list('viewer')).unreadCount).toBe(0);
    expect((await list('owner')).unreadCount).toBe(1);
  });

  it('answers 404 for another pool’s notification and leaves it unread', async () => {
    const b = await notificationIn(s, 'B');
    await expect(
      world.notifications.markRead(await s.as('owner'), s.poolA, b.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await list('outsider', {}, s.poolB)).unreadCount).toBe(1);
  });

  it('answers 404 to a non-member, 401 without a session, and 404 for bad ids and payloads', async () => {
    const one = await notificationIn(s, 'A');
    await expect(
      world.notifications.markRead(await s.as('outsider'), s.poolA, one.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.notifications.markRead(new Headers(), s.poolA, one.id),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    for (const id of [
      'nope',
      "' OR 1=1 --",
      "'; DROP TABLE notifications; --",
      crypto.randomUUID(),
    ]) {
      await expect(
        world.notifications.markRead(await s.as('owner'), s.poolA, id),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    expect((await list('owner')).unreadCount).toBe(1);
  });
});

describe('markAllRead', () => {
  it('marks everything for the caller only and answers how many', async () => {
    await notificationIn(s, 'A', '2026-03');
    await notificationIn(s, 'A', '2026-04');
    const owner = await s.as('owner');
    expect(await world.notifications.markAllRead(owner, s.poolA)).toEqual({ marked: 2 });
    expect(await world.notifications.markAllRead(owner, s.poolA)).toEqual({ marked: 0 });
    expect((await list('owner')).unreadCount).toBe(0);
    expect((await list('member')).unreadCount).toBe(2);
  });

  it('does not touch another pool and refuses non-members', async () => {
    await notificationIn(s, 'A');
    await notificationIn(s, 'B');
    await expect(
      world.notifications.markAllRead(await s.as('outsider'), s.poolA),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await world.notifications.markAllRead(await s.as('owner'), s.poolA)).toEqual({
      marked: 1,
    });
    expect((await list('outsider', {}, s.poolB)).unreadCount).toBe(1);
    await expect(world.notifications.markAllRead(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
