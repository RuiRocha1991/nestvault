import { describe, expect, it, vi } from 'vitest';

import type { PlanReminderView } from '@webapp/lib/plan-reminders-view';
import { createReminderActions } from '@webapp/lib/reminder-actions';

const POOL = '0192f3a1-aaaa-7000-8000-000000000000';
const reminder: PlanReminderView = {
  id: '0192f3a1-0000-7000-8000-000000000051',
  planId: '0192f3a1-0000-7000-8000-000000000040',
  period: '2026-10',
  read: false,
  ticker: 'VWCE',
  assetType: 'etf',
  amount: '100',
  currency: 'EUR',
  day: 5,
  portfolioId: '0192f3a1-0000-7000-8000-000000000020',
  portfolioName: 'Longo prazo',
  active: true,
};

function setup(answer: () => Promise<{ ok: boolean; status: number }>) {
  const calls: string[] = [];
  const deps = {
    post: vi.fn((path: string) => {
      calls.push(`post ${path}`);
      return answer();
    }),
    refresh: vi.fn(() => calls.push('refresh')),
    notify: vi.fn((notice: string) => calls.push(`notify ${notice}`)),
    setBusy: vi.fn((id: string | null) => calls.push(`busy ${id === null ? 'off' : 'on'}`)),
    settled: vi.fn(() => calls.push('settled')),
  };
  return { deps, calls, actions: createReminderActions(POOL, deps) };
}

const ok = () => Promise.resolve({ ok: true, status: 201 });
const status = (code: number) => () => Promise.resolve({ ok: false, status: code });

describe('createReminderActions', () => {
  it('registers the buy for the reminder month, tells the user, moves focus and refreshes', async () => {
    const { actions, deps, calls } = setup(ok);
    await actions.register(reminder);
    expect(deps.post).toHaveBeenCalledWith(`/api/v1/pools/${POOL}/plans/${reminder.planId}/run`, {
      month: '2026-10',
    });
    expect(calls).toEqual([
      'busy on',
      `post /api/v1/pools/${POOL}/plans/${reminder.planId}/run`,
      'notify registered',
      'settled',
      'refresh',
      'busy off',
    ]);
  });

  it('marks as read without a toast', async () => {
    const { actions, deps } = setup(ok);
    await actions.markRead(reminder);
    expect(deps.post).toHaveBeenCalledWith(
      `/api/v1/pools/${POOL}/notifications/${reminder.id}/read`,
      {},
    );
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.refresh).toHaveBeenCalledTimes(1);
  });

  it('ignores a second click while the first request runs, then accepts the next one', async () => {
    let release: (value: { ok: boolean; status: number }) => void = () => undefined;
    const { actions, deps } = setup(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = actions.register(reminder);
    await actions.register(reminder);
    await actions.markRead(reminder);
    expect(deps.post).toHaveBeenCalledTimes(1);
    release({ ok: true, status: 201 });
    await first;
    expect(deps.setBusy).toHaveBeenLastCalledWith(null);
    void actions.register(reminder);
    expect(deps.post).toHaveBeenCalledTimes(2);
  });

  it.each([
    [404, 'notFound'],
    [403, 'forbidden'],
    [409, 'inactive'],
    [500, 'failed'],
    [429, 'failed'],
  ])('a %i answer refreshes the stale row and says %s', async (code, notice) => {
    const { actions, deps } = setup(status(code));
    await actions.register(reminder);
    expect(deps.notify).toHaveBeenCalledWith(notice);
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    expect(deps.settled).not.toHaveBeenCalled();
    expect(deps.setBusy).toHaveBeenLastCalledWith(null);
  });

  it('a 404 on mark-as-read (resolved meanwhile) also refreshes and explains', async () => {
    const { actions, deps } = setup(status(404));
    await actions.markRead(reminder);
    expect(deps.notify).toHaveBeenCalledWith('notFound');
    expect(deps.refresh).toHaveBeenCalledTimes(1);
  });

  it('a network failure says so, frees the buttons and does not refresh', async () => {
    const { actions, deps } = setup(() => Promise.reject(new Error('offline')));
    await actions.register(reminder);
    expect(deps.notify).toHaveBeenCalledWith('failed');
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(deps.setBusy).toHaveBeenLastCalledWith(null);
    await actions.register(reminder);
    expect(deps.post).toHaveBeenCalledTimes(2);
  });
});
