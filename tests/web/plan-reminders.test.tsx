import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@nestvault/ui';
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
      <ToastProvider>{node}</ToastProvider>
    </NextIntlClientProvider>,
  );

export const reminder = (over: Partial<PlanReminderView> = {}): PlanReminderView => ({
  id: N1,
  planId: PLAN,
  period: '2026-10',
  read: false,
  ticker: 'VWCE',
  assetType: 'etf',
  amount: '100',
  currency: 'USD',
  day: 5,
  portfolioId: PORTFOLIO,
  portfolioName: 'Longo prazo',
  active: true,
  ...over,
});

describe('buildPlanReminders', () => {
  const plan = (id: string, active = true) => ({
    id,
    portfolioId: PORTFOLIO,
    assetId: ASSET,
    amount: '100',
    day: 5,
    active,
  });
  const asset = { id: ASSET, ticker: 'VWCE', type: 'etf' as const, currency: 'USD' };
  const portfolio = { id: PORTFOLIO, name: 'Longo prazo' };
  const note = (over: Record<string, unknown>) => ({
    id: N1,
    kind: 'plan_reminder' as const,
    planId: PLAN,
    period: '2026-10',
    createdAt: '2026-10-15T09:00:00.000Z',
    read: false,
    ...over,
  });

  it('joins the notification with its plan, asset (currency) and portfolio', () => {
    const reminders = buildPlanReminders(
      [note({}), note({ id: N2, read: true })],
      [plan(PLAN)],
      [asset],
      [portfolio],
    );
    expect(reminders).toHaveLength(2);
    expect(reminders[0]).toEqual(reminder());
    expect(reminders[1]?.read).toBe(true);
  });

  it('drops reminders with an unknown plan, asset or portfolio, a blank ticker or a bad period', () => {
    const build = (n: Record<string, unknown>, a = [asset], p = [portfolio]) =>
      buildPlanReminders([note(n)], [plan(PLAN)], a, p);
    expect(build({ planId: PLAN_GONE })).toEqual([]);
    expect(build({ planId: null })).toEqual([]);
    expect(build({ period: null })).toEqual([]);
    expect(build({ period: '2026-13' })).toEqual([]);
    expect(build({}, [], [portfolio])).toEqual([]);
    expect(build({}, [{ ...asset, ticker: '' }], [portfolio])).toEqual([]);
    expect(build({}, [asset], [])).toEqual([]);
  });

  it('keeps a paused plan, flagged inactive', () => {
    const [kept] = buildPlanReminders([note({})], [plan(PLAN, false)], [asset], [portfolio]);
    expect(kept?.active).toBe(false);
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
  const NBSP = ' ';

  it('renders asset, amount in the asset currency, plan day, portfolio and month', () => {
    const html = render([reminder()], 'banner');
    expect(html).toContain('Investimentos regulares por registar');
    expect(html).toContain('VWCE');
    expect(html).toContain(`100,00${NBSP}US$`);
    expect(html).toContain('dia 5 · Longo prazo · 10/2026');
    expect(html).toContain('border-warn');
    expect(html).toContain('Registar compra');
    expect(html).toContain('Marcar como lido');
  });

  it('gives the buttons accessible names with ticker and month', () => {
    const html = render([reminder()], 'banner');
    expect(html).toContain('aria-label="Registar compra de VWCE (10/2026)"');
    expect(html).toContain('aria-label="Marcar como lido: VWCE (10/2026)"');
  });

  it('shows nothing in the banner when every reminder is read, or there are none', () => {
    expect(render([reminder({ read: true })], 'banner')).not.toContain('plan-reminders');
    expect(render([], 'list')).not.toContain('plan-reminders');
  });

  it('lists read reminders too (labelled, without mark-read) and counts the unread', () => {
    const html = render([reminder(), reminder({ id: N2, read: true })], 'list');
    expect(html.match(/data-testid="plan-reminder"/g)).toHaveLength(2);
    expect(html).toContain('1 por ler');
    expect(html).toContain('>Lido<');
    expect(html.match(/aria-label="Marcar como lido/g)).toHaveLength(1);
  });

  it('hides Registar compra without ops.write (a viewer, on any plan) and for a paused plan', () => {
    expect(render([reminder()], 'banner', false)).not.toContain('Registar compra');
    expect(render([reminder({ active: false })], 'banner')).not.toContain('Registar compra');
    // Reading and marking as read stay available to every member.
    expect(render([reminder()], 'banner', false)).toContain('Marcar como lido');
  });
});
