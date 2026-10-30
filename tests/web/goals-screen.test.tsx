import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { GoalsScreen, type GoalsScreenProps } from '@webapp/components/goals/goals-screen';
import type { GoalView } from '@webapp/lib/goals-view';

import messages from '../../apps/web/messages/pt-PT.json';
import { NextIntlClientProvider } from '../../apps/web/node_modules/next-intl';

vi.mock('../../apps/web/node_modules/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-PT" messages={messages} timeZone="Europe/Lisbon">
      {node}
    </NextIntlClientProvider>,
  ).replace(/[\u00a0\u202f]/g, ' ');

const POOL = '0192f3a1-0000-7000-8000-0000000000aa';

const goal = (
  patch: Partial<GoalView> = {},
  result: Partial<GoalView['result']> = {},
): GoalView => ({
  id: '0192f3a1-0000-7000-8000-000000000001',
  name: 'Independência financeira',
  color: '#9D6BFF',
  type: 'value',
  target: '300000.0000',
  mode: 'date',
  deadline: '2046-10-11',
  monthly: '450.0000',
  rate: '6.000000',
  yield: null,
  includeSavings: false,
  portfolioIds: [],
  accounts: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...patch,
  result: {
    mode: 'date',
    current: '51680',
    target: '300000',
    projected: '369793',
    required: '296.08',
    reachIn: null,
    etaMonth: null,
    months: 240,
    progress: '17.2',
    done: false,
    onTrack: true,
    status: 'on_track',
    yieldPct: '0',
    monthly: '450',
    path: [
      { month: 0, planned: '51680', required: '51680' },
      { month: 120, planned: '150000', required: '160000' },
      { month: 240, planned: '369793', required: '300000' },
    ],
    scopeNames: [],
    includesSavings: false,
    ...result,
  },
});

const screen = (props: Partial<GoalsScreenProps> = {}) =>
  wrap(
    <GoalsScreen
      poolId={POOL}
      asOf="2026-10-28"
      goals={[goal()]}
      scope={{ portfolios: [], accounts: [] }}
      defaultMonthly="0"
      defaultDeadline="2036-10-28"
      canWrite
      {...props}
    />,
  );

describe('GoalsScreen', () => {
  it('shows a card with the ring, the status and the numbers of a goal with a deadline', () => {
    const html = screen();
    expect(html).toContain('Independência financeira');
    expect(html).toContain('Valor a atingir · até 11/10/2046');
    expect(html).toContain('No ritmo');
    expect(html).toContain('51 680,00');
    expect(html).toContain('300 000,00');
    expect(html).toContain('Projeção no prazo');
    expect(html).toContain('369 793,00');
    expect(html).toContain('Necessário por mês');
    expect(html).toContain('17%');
  });

  it('explains the projection under the chart and names what the goal counts', () => {
    const html = screen();
    expect(html).toContain('Projeção · Independência financeira');
    expect(html).toContain('o valor projetado no prazo é');
    expect(html).toContain('Âmbito: todos os portfolios.');
  });

  it('shows the forecast of a goal without a date and the missing amount', () => {
    const html = screen({
      goals: [
        goal(
          { mode: 'eta', deadline: null },
          { mode: 'eta', status: 'eta', etaMonth: '2028-02', reachIn: 16, projected: null },
        ),
      ],
    });
    expect(html).toContain('Valor a atingir · sem data limite');
    expect(html).toContain('Atinges em Fev 2028');
    expect(html).toContain('Falta');
    expect(html).toContain('Previsão');
    expect(html).toContain('Fev 2028 (16 meses)');
  });

  it('writes an income goal per year', () => {
    const html = screen({
      goals: [
        goal(
          { type: 'income', target: '1200.0000' },
          { current: '82.98', target: '1200', yieldPct: '4' },
        ),
      ],
    });
    expect(html).toContain('Rendimento passivo anual');
    expect(html).toContain('1 200,00 €/ano');
  });

  it('has no projection chart for a tracked goal', () => {
    const html = screen({
      goals: [goal({ mode: 'none', deadline: null }, { mode: 'none', status: 'tracking' })],
    });
    expect(html).toContain('A acompanhar');
    expect(html).toContain('Este objetivo não tem projeção.');
  });

  it('offers to create, edit and delete only to who may write', () => {
    expect(screen()).toContain('Novo objetivo');
    expect(screen()).toContain('Editar');
    const readOnly = screen({ canWrite: false });
    expect(readOnly).not.toContain('Novo objetivo');
    expect(readOnly).not.toContain('Editar');
    expect(readOnly).not.toContain('Apagar');
  });

  it('shows an empty state without goals', () => {
    const html = screen({ goals: [] });
    expect(html).toContain('Ainda não há objetivos.');
    expect(html).not.toContain('Projeção ·');
  });

  it('escapes a goal name', () => {
    const html = screen({ goals: [goal({ name: '<img src=x onerror=alert(1)>' })] });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});
