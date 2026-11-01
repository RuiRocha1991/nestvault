import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { PlanReminders } from '@webapp/components/notifications/plan-reminders';
import {
  buildPlanReminders,
  formatPeriod,
  markReadRequest,
  registerRequest,
  remindersOf,
  type PlanReminderView,
} from '@webapp/lib/plan-reminders-view';

import messages from '../../apps/web/messages/pt-PT.json';
import { NextIntlClientProvider } from '../../apps/web/node_modules/next-intl';

vi.mock('../../apps/web/node_modules/next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const POOL = '0192f3a1-aaaa-7000-8000-000000000000';
const PORTFOLIO = '0192f3a1-0000-7000-8000-000000000020';
const OTHER_PORTFOLIO = '0192f3a1-0000-7000-8000-000000000021';
const ASSET = '0192f3a1-0000-7000-8000-000000000030';
const PLAN = '0192f3a1-0000-7000-8000-000000000040';
const PLAN_GONE = '0192f3a1-0000-7000-8000-000000000041';
const N1 = '0192f3a1-0000-7000-8000-000000000051';
const N2 = '0192f3a1-0000-7000-8000-000000000052';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-PT" messages={messages} timeZone="Europe/Lisbon">
      {node}
    </NextIntlClientProvider>,
  );

const reminder = (over: Partial<PlanReminderView> = {}): PlanReminderView => ({
  id: N1,
  planId: PLAN,
  period: '2026-10',
  read: false,
  createdAt: '2026-10-15T09:00:00.000Z',
  ticker: 'VWCE',
  amount: '100',
  portfolioId: PORTFOLIO,
  active: true,
  ...over,
});

describe('buildPlanReminders', () => {
  const plan = (id: string, active = true) => ({
    id,
    portfolioId: PORTFOLIO,
    assetId: ASSET,
    accountId: null,
    subAccountId: null,
    amount: '100',
    day: 5,
    active,
  });
  const note = (over: Record<string, unknown>) => ({
    id: N1,
    kind: 'plan_reminder' as const,
    planId: PLAN,
    period: '2026-10',
    createdAt: '2026-10-15T09:00:00.000Z',
    read: false,
    ...over,
  });

  it('joins the notification with its plan and the asset ticker', () => {
    const { reminders } = buildPlanReminders(
      [note({}), note({ id: N2, read: true })],
      [plan(PLAN)],
      new Map([[ASSET, 'VWCE']]),
    );
    expect(reminders).toHaveLength(2);
    expect(reminders[0]).toMatchObject({ id: N1, ticker: 'VWCE', amount: '100', read: false });
    expect(reminders[1]?.read).toBe(true);
  });

  it('drops reminders whose plan is unknown or whose period is invalid', () => {
    const { reminders } = buildPlanReminders(
      [note({ planId: PLAN_GONE }), note({ id: N2, period: null }), note({ period: '2026-13' })],
      [plan(PLAN)],
      new Map(),
    );
    expect(reminders).toEqual([]);
  });

  it('keeps a paused plan, flagged inactive', () => {
    const { reminders } = buildPlanReminders([note({})], [plan(PLAN, false)], new Map());
    expect(reminders[0]?.active).toBe(false);
  });

  it('formats the period and filters by portfolio', () => {
    expect(formatPeriod('2026-10')).toBe('10/2026');
    const all = [reminder(), reminder({ id: N2, portfolioId: OTHER_PORTFOLIO })];
    expect(remindersOf(all, null)).toHaveLength(2);
    expect(remindersOf(all, PORTFOLIO).map((r) => r.id)).toEqual([N1]);
  });

  it('builds the plan-run and mark-read calls for the reminder month, URL-encoded', () => {
    expect(registerRequest(POOL, reminder())).toEqual({
      path: `/api/v1/pools/${POOL}/plans/${PLAN}/run`,
      body: { month: '2026-10' },
    });
    expect(markReadRequest(POOL, reminder()).path).toBe(
      `/api/v1/pools/${POOL}/notifications/${N1}/read`,
    );
    expect(registerRequest('a/b', reminder({ planId: '../x' })).path).toBe(
      '/api/v1/pools/a%2Fb/plans/..%2Fx/run',
    );
  });
});

describe('PlanReminders', () => {
  const render = (reminders: PlanReminderView[], variant: 'banner' | 'list', canRegister = true) =>
    wrap(
      <PlanReminders
        poolId={POOL}
        reminders={reminders}
        variant={variant}
        canRegister={canRegister}
      />,
    );

  it('renders the message in Portuguese with ticker, amount and month', () => {
    const html = render([reminder()], 'banner');
    expect(html).toContain('Investimento regular por registar: VWCE');
    expect(html).toContain('(10/2026)');
    expect(html).toContain('Registar');
    expect(html).toContain('Marcar como lido');
  });

  it('shows nothing in the banner when every reminder is read, or there are none', () => {
    expect(render([reminder({ read: true })], 'banner')).toBe('');
    expect(render([], 'list')).toBe('');
  });

  it('lists read reminders too, without the mark-read button, and counts the unread', () => {
    const html = render([reminder(), reminder({ id: N2, read: true })], 'list');
    expect(html.match(/data-testid="plan-reminder"/g)).toHaveLength(2);
    expect(html).toContain('1 por ler');
    expect(html.match(/Marcar como lido/g)).toHaveLength(1);
  });

  it('hides Registar without ops.write and for a paused plan', () => {
    expect(render([reminder()], 'banner', false)).not.toContain('Registar');
    expect(render([reminder({ active: false })], 'banner')).not.toContain('>Registar<');
  });
});
