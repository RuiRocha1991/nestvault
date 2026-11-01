import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger, NotFoundError } from '@nestvault/services';

const notificationsList = vi.fn();
const plansList = vi.fn();
const assetsList = vi.fn();
const portfoliosList = vi.fn();
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

vi.mock('../../apps/web/node_modules/next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock('../../apps/web/node_modules/next/navigation', () => ({
  notFound: () => notFound(),
}));
vi.mock('@webapp/server/auth', () => ({
  getNotificationsService: () => Promise.resolve({ list: notificationsList }),
  getPlansService: () => Promise.resolve({ list: plansList }),
  getAssetsService: () => Promise.resolve({ list: assetsList }),
  getPortfoliosService: () => Promise.resolve({ list: portfoliosList }),
}));

const { getOpenNotifications, getPlanReminders } = await import('@webapp/server/plan-reminders');

const POOL = '0192f3a1-aaaa-7000-8000-000000000000';
const note = {
  id: '0192f3a1-0000-7000-8000-000000000051',
  kind: 'plan_reminder',
  planId: '0192f3a1-0000-7000-8000-000000000040',
  period: '2026-10',
  createdAt: '2026-10-15T09:00:00.000Z',
  read: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  notificationsList.mockResolvedValue({ notifications: [note], unreadCount: 1 });
  plansList.mockResolvedValue({
    plans: [
      {
        id: note.planId,
        portfolioId: 'p1',
        assetId: 'a1',
        amount: '100',
        day: 5,
        active: true,
      },
    ],
  });
  assetsList.mockResolvedValue({
    assets: [{ id: 'a1', ticker: 'VWCE', type: 'etf', currency: 'EUR' }],
  });
  portfoliosList.mockResolvedValue({ portfolios: [{ id: 'p1', name: 'Longo prazo' }] });
});

describe('getPlanReminders', () => {
  it('builds the reminders from the notifications, plans, assets and portfolios', async () => {
    const reminders = await getPlanReminders(POOL);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ ticker: 'VWCE', portfolioName: 'Longo prazo', day: 5 });
  });

  it('degrades to an empty list when any extra call fails, logging the error type only', async () => {
    plansList.mockRejectedValue(new TypeError('secret detail 123,45 EUR'));
    expect(await getPlanReminders(`${POOL}-degraded`)).toEqual([]);
    expect(warn).toHaveBeenCalledWith({ errorType: 'TypeError' }, expect.any(String));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
    expect(notFound).not.toHaveBeenCalled();
  });

  it('keeps the 404 page for a pool the caller cannot see', async () => {
    notificationsList.mockRejectedValue(new NotFoundError());
    await expect(getPlanReminders(`${POOL}-404`)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('getOpenNotifications', () => {
  it('returns the open notifications', async () => {
    expect(await getOpenNotifications(`${POOL}-list`)).toEqual([note]);
  });

  it('degrades to an empty list on a failure and 404s for a non-member', async () => {
    notificationsList.mockRejectedValueOnce(new Error('db down'));
    expect(await getOpenNotifications(`${POOL}-down`)).toEqual([]);
    notificationsList.mockRejectedValueOnce(new NotFoundError());
    await expect(getOpenNotifications(`${POOL}-nf`)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
