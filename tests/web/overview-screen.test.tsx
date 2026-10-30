import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  OverviewScreen,
  type OverviewScreenProps,
} from '@webapp/components/overview/overview-screen';

import messages from '../../apps/web/messages/pt-PT.json';
import { NextIntlClientProvider } from '../../apps/web/node_modules/next-intl';

vi.mock('../../apps/web/node_modules/next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/0192f3a1-aaaa-7000-8000-000000000000/visao-geral',
}));
vi.mock('@webapp/components/shell', () => ({
  MENU_BUTTON_ID: 'menu-button',
  SIDEBAR_ID: 'sidebar',
  useShell: () => ({ drawerOpen: false, openDrawer: vi.fn() }),
}));

const POOL = '0192f3a1-aaaa-7000-8000-000000000000';
const NBSP = '\u00a0';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-PT" messages={messages} timeZone="Europe/Lisbon">
      {node}
    </NextIntlClientProvider>,
  );

const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
const spark = months.map((_, i) => String(1000 + i * 10));

const DATA: OverviewScreenProps['data'] = {
  asOf: '2026-10-21',
  range: '12',
  empty: false,
  kpis: {
    netWorth: { value: '89325.5', changePct: '0.2', spark },
    investments: { value: '29199', returnPct: '11.2', spark },
    passiveIncome: {
      annual: '82.98',
      monthly: '6.92',
      yieldPct: '0.3',
      interest12: '240.01',
      spark,
    },
    monthExpenses: {
      value: '927.81',
      budget: '1800',
      budgetUsedPct: '51.5',
      changePct: '-3',
      spark,
    },
  },
  realEstate: null,
  evolution: { months, total: spark, investments: spark },
  goals: [
    {
      id: '0192f3a1-0000-7000-8000-000000000010',
      name: 'Independência financeira',
      color: '#9D6BFF',
      progress: '17',
      status: 'on_track',
      etaMonth: null,
    },
    {
      id: '0192f3a1-0000-7000-8000-000000000011',
      name: 'Fundo para a universidade',
      color: '#2BC6B4',
      progress: '15',
      status: 'eta',
      etaMonth: '2027-03',
    },
  ],
  portfolios: [
    {
      id: '0192f3a1-0000-7000-8000-000000000020',
      name: 'Longo prazo',
      color: '#9D6BFF',
      currency: 'EUR',
      value: '3756.36',
      returnPct: '7.3',
    },
    {
      id: '0192f3a1-0000-7000-8000-000000000021',
      name: '<b>Obras</b>',
      color: '#2BC6B4',
      currency: 'EUR',
      value: '8029.04',
      returnPct: '-0.4',
    },
  ],
  expenses: {
    month: '2026-10',
    total: '927.81',
    categories: [
      {
        categoryId: '0192f3a1-0000-7000-8000-000000000030',
        systemKey: 'housing',
        name: null,
        color: '#6C5CFF',
        value: '620',
      },
      {
        categoryId: '0192f3a1-0000-7000-8000-000000000031',
        systemKey: null,
        name: 'Cantina',
        color: '#F2913D',
        value: '136.69',
      },
    ],
  },
  dividends: {
    months: months.map((_, i) => `2026-${String(((i + 9) % 12) + 1).padStart(2, '0')}`),
    values: months.map((_, i) => (i % 3 === 0 ? '12.5' : '0')),
    total: '50',
    hasDividends: true,
  },
};

const ALL = { addTransaction: true, addPortfolio: true, addAccount: true };
const HOLDERS = [
  { id: '0192f3a1-0000-7000-8000-000000000001', name: 'Rui', color: '#F2913D' },
  { id: '0192f3a1-0000-7000-8000-000000000002', name: 'Ana', color: '#6C5CFF' },
];

const screen = (over: Partial<OverviewScreenProps> = {}) =>
  wrap(<OverviewScreen poolId={POOL} data={DATA} holders={HOLDERS} can={ALL} {...over} />);

describe('overview screen', () => {
  it('shows the four KPIs with their values and sub-lines', () => {
    const html = screen();
    expect(html).toContain('Património líquido');
    expect(html).toContain(`89${NBSP}326${NBSP}€`);
    expect(html).toContain('vs. mês anterior');
    expect(html).toContain(`29${NBSP}199${NBSP}€`);
    expect(html).toContain('retorno total');
    expect(html).toContain(`82,98${NBSP}€`);
    expect(html).toContain('/ano');
    expect(html).toContain(`6,92${NBSP}€/mês · yield 0,3%`);
    expect(html).toContain('juros em 12 m');
    expect(html).toContain(`928${NBSP}€`);
    expect(html).toContain('52% do orçamento');
  });

  it('draws the chart, the goals, the portfolios, the donut and the dividend bars', () => {
    const html = screen();
    expect(html).toContain('Evolução do património');
    expect(html).toContain('aria-label="Evolução do património líquido e dos investimentos"');
    expect(html).toContain('Independência financeira');
    expect(html).toContain('No ritmo');
    expect(html).toContain('Atinges em Mar');
    expect(html).toContain('Longo prazo');
    expect(html).toContain(`3${NBSP}756${NBSP}€`);
    expect(html).toContain('+7,3%');
    expect(html).toContain('-0,4%');
    expect(html).toContain('aria-label="Despesas do mês por categoria"');
    expect(html).toContain('Habitação');
    expect(html).toContain('Cantina');
    expect(html).toContain('aria-label="Dividendos previstos nos próximos 12 meses"');
    expect(html).toContain('Previsão bruta para 12 meses:');
  });

  it('escapes a portfolio name instead of rendering markup', () => {
    const html = screen();
    expect(html).not.toContain('<b>Obras</b>');
    expect(html).toContain('&lt;b&gt;Obras&lt;/b&gt;');
  });

  it('links to the other screens and to the search page', () => {
    const html = screen();
    expect(html).toContain(`href="/${POOL}/objetivos"`);
    expect(html).toContain(`href="/${POOL}/despesas"`);
    expect(html).toContain(`href="/${POOL}/portfolios"`);
    expect(html).toContain(`action="/${POOL}/pesquisa"`);
    expect(html).toContain('name="q"');
    expect(html).toContain('Rui &amp; Ana');
  });

  it('gives a member the "+ Transação" and "Novo" buttons', () => {
    const html = screen();
    expect(html).toContain(`href="/${POOL}/despesas?nova=1"`);
    expect(html).toContain(`href="/${POOL}/portfolios?novo=1"`);
  });

  it('hides every write button from a viewer', () => {
    const html = screen({ can: { addTransaction: false, addPortfolio: false, addAccount: false } });
    expect(html).not.toContain('nova=1');
    expect(html).not.toContain('novo=1');
    expect(html).not.toContain('Novo<');
    expect(html).toContain('Património líquido');
  });

  it('shows the budget in red when it is exceeded and the change when there is no budget', () => {
    const over = screen({
      data: {
        ...DATA,
        kpis: {
          ...DATA.kpis,
          monthExpenses: { ...DATA.kpis.monthExpenses, value: '2000', budgetUsedPct: '111.1' },
        },
      },
    });
    expect(over).toContain('text-neg');
    expect(over).toContain('111% do orçamento');
    const none = screen({
      data: {
        ...DATA,
        kpis: {
          ...DATA.kpis,
          monthExpenses: { ...DATA.kpis.monthExpenses, budget: null, budgetUsedPct: null },
        },
      },
    });
    expect(none).not.toContain('do orçamento');
    expect(none).toContain('vs. mês anterior');
  });

  it('hides the dividends card for a pool without any dividend', () => {
    const html = screen({
      data: { ...DATA, dividends: { ...DATA.dividends, hasDividends: false } },
    });
    expect(html).not.toContain('Próximos dividendos');
    expect(html).not.toContain('Previsão bruta para 12 meses:');
    expect(html).toContain('Despesas por categoria');
  });

  it('explains an empty goals card and an empty month', () => {
    const html = screen({
      data: { ...DATA, goals: [], expenses: { month: '2026-10', total: '0', categories: [] } },
    });
    expect(html).toContain('Ainda não há objetivos.');
    expect(html).toContain('Sem despesas este mês.');
  });

  it('shows the call to action for a new pool, with the buttons only for who can use them', () => {
    const empty = { ...DATA, empty: true };
    const html = screen({ data: empty });
    expect(html).toContain('Vamos começar');
    expect(html).toContain(`href="/${POOL}/contas"`);
    expect(html).not.toContain('Evolução do património');
    const viewer = screen({
      data: empty,
      can: { addTransaction: false, addPortfolio: false, addAccount: false },
    });
    expect(viewer).toContain('Vamos começar');
    expect(viewer).not.toContain('Criar conta');
  });
});
