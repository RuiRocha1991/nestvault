import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@nestvault/ui';
import {
  PortfoliosScreen,
  type PortfoliosScreenProps,
} from '@webapp/components/portfolios/portfolios-screen';
import type { TabContext } from '@webapp/components/portfolios/types';

import messages from '../../apps/web/messages/pt-PT.json';
import { NextIntlClientProvider } from '../../apps/web/node_modules/next-intl';

vi.mock('../../apps/web/node_modules/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-PT" messages={messages} timeZone="Europe/Lisbon">
      <ToastProvider>{node}</ToastProvider>
    </NextIntlClientProvider>,
  );

const PORTFOLIO = '0192f3a1-0000-7000-8000-000000000001';
const ASSET = '0192f3a1-0000-7000-8000-000000000002';
const OP = '0192f3a1-0000-7000-8000-000000000003';
const ASSET_VIEW = {
  id: ASSET,
  ticker: 'VWCE',
  symbol: null,
  name: 'Vanguard FTSE All-World',
  type: 'etf' as const,
  currency: 'EUR',
  sector: 'Diversificado',
  region: 'Global',
  dps: null,
  divMonths: [],
  price: '12',
  priceDate: '2026-09-01',
};
const HOLDING = {
  key: ASSET,
  assetId: ASSET,
  accountId: null,
  subAccountId: null,
  currency: 'EUR',
  qty: '10',
  avg: '10',
  price: '12',
  valueN: '120',
  dayN: '2',
  day: '2',
  dayPct: '0.0169',
  gainN: '20',
  divsN: '0',
  totalN: '20',
  value: '120',
  cost: '100',
  gain: '20',
  gainPct: '0.2',
  divs: '0',
  total: '20',
  income: '0',
  yld: '0',
  yoc: '0',
  weight: '1',
  isOpen: true,
};

const ctx = (over: Partial<TabContext> = {}): TabContext => ({
  poolId: 'pool',
  portfolioId: PORTFOLIO,
  portfolios: [
    {
      id: PORTFOLIO,
      name: 'Longo prazo',
      color: '#9d6bff',
      currency: 'EUR',
      note: null,
      targets: { etf: '100' },
      opsCount: 1,
      plansCount: 0,
    },
  ],
  summary: {
    asOf: '2026-09-01',
    portfolioId: PORTFOLIO,
    profit: '20',
    profitPct: '0.2',
    divGross: '0',
    realized: '0',
    total: '20',
    totalPct: '0.2',
    valueAll: '120',
    value: '120',
    cost: '100',
    gain: '20',
    gainPct: '0.2',
    cash: '0',
    cashEur: '0',
    currency: 'EUR',
    netInvested: '100',
    divs: '0',
    divs12: '0',
    income: '0',
    yld: '0',
    yoc: '0',
    tax: '0',
    refund: '0',
    other: '0',
    irr: 0.087,
    positions: 1,
  } as unknown as TabContext['summary'],
  data: {
    asOf: '2026-09-01',
    portfolioId: PORTFOLIO,
    hasDividends: true,
    dayGain: '2',
    dayGainPct: '0.0169',
    display: {
      mode: 'portfolio',
      currency: 'EUR',
      baseCurrency: 'EUR',
      portfolioCurrency: 'EUR',
      fixed: false,
      rates: [],
    },
    holdings: [HOLDING],
    positions: [HOLDING],
    ops: [
      {
        id: OP,
        portfolioId: PORTFOLIO,
        assetId: ASSET,
        accountId: null,
        subAccountId: null,
        type: 'buy',
        date: '2026-01-10',
        qty: '10',
        price: '10',
        fee: null,
        amount: null,
        gross: null,
        tax: null,
        fromCash: false,
        planId: null,
        note: '<b>lembrete</b>',
        native: '-100',
        converted: '-100',
      },
    ],
    received: [{ month: '2026-09', value: '0' }],
    forecast: [{ month: '2026-09', value: '0', items: [] }],
    incomeNet: '0',
    performance: {
      months: ['2026-01', '2026-02'],
      value: ['100', '110'],
      invested: ['100', '100'],
    },
    allocation: {
      type: [{ name: 'etf', value: '120' }],
      sector: [{ name: 'Diversificado', value: '120' }],
      region: [{ name: 'Global', value: '120' }],
      currency: [{ name: 'EUR', value: '120' }],
    },
    diagnostics: [
      {
        code: 'topPosition',
        bad: true,
        weight: '1',
        assetId: ASSET,
        positions: null,
        sectors: null,
        regions: null,
      },
    ],
  },
  assets: [ASSET_VIEW],
  assetsById: new Map([[ASSET, ASSET_VIEW]]),
  currencyMode: 'portfolio',
  linkedAccounts: [],
  accounts: [],
  plans: [],
  holders: [],
  permissions: { ops: true, portfolios: true, notes: true },
  ...over,
});

const screen = (tab: PortfoliosScreenProps['tab'], over: Partial<TabContext> = {}) =>
  wrap(
    <PortfoliosScreen
      ctx={ctx(over)}
      chips={[
        { id: null, name: 'Todos', color: '', value: '120', currency: 'EUR' },
        { id: PORTFOLIO, name: 'Longo prazo', color: '#9d6bff', value: '120', currency: 'EUR' },
      ]}
      tab={tab}
      group="asset"
      today="2026-09-01"
    />,
  );

describe('PortfoliosScreen', () => {
  it('links the chips and the tabs, keeping the portfolio and the tab in the URL', () => {
    const html = screen('dividends');
    expect(html).toContain('href="/pool/portfolios?tab=dividends"');
    expect(html).toContain(`href="/pool/portfolios/${PORTFOLIO}?tab=dividends"`);
    expect(html).toContain(`href="/pool/portfolios/${PORTFOLIO}"`); // the Resumo tab
    expect(html).toMatch(/aria-current="page"[^>]*>Dividendos</);
  });

  it('shows the summary numbers', () => {
    const html = screen('summary');
    expect(html).toContain('120,00');
    expect(html).toContain('+8,7%');
    expect(html).toContain('+20,00');
  });

  it('lists the positions with the gain and the weight', () => {
    const html = screen('positions');
    expect(html).toContain('VWCE');
    expect(html).toContain('+20,0%');
    expect(html).toContain('100,0%');
  });

  it('lists the transactions with a note indicator and the note as escaped text only in the panel', () => {
    const html = screen('transactions');
    expect(html).toContain('aria-label="Ver nota"');
    expect(html).not.toContain('<b>lembrete</b>');
    expect(html).toContain('Compra');
  });

  it('shows the diagnostic of the analysis tab', () => {
    const html = screen('analysis');
    expect(html).toContain('Atenção');
    expect(html).toContain('Maior posição: VWCE com 100,0% do portfolio');
  });

  it('hides the write actions from a viewer', () => {
    const html = screen('transactions', {
      permissions: { ops: false, portfolios: false, notes: false },
    });
    expect(html).not.toContain('Editar transação');
    expect(html).not.toContain('Apagar transação');
  });

  it('offers the currency choice, keeps it in the links and shows the rate used', () => {
    const usd = {
      mode: 'base' as const,
      currency: 'EUR',
      baseCurrency: 'EUR',
      portfolioCurrency: 'USD',
      fixed: false,
      rates: [{ currency: 'USD', rate: '0.92', source: 'ecb' as const, date: '2026-09-01' }],
    };
    const html = screen('dividends', {
      currencyMode: 'base',
      data: { ...ctx().data, display: usd },
    });
    expect(html).toContain('Moeda do portfolio');
    expect(html).toContain('Moeda base');
    expect(html).toContain('href="/pool/portfolios?tab=dividends&amp;moeda=base"');
    expect(html).toContain('1\u00a0US$ = 0,9200\u00a0€');
    expect(html).toContain('BCE · 01/09/2026');
    expect(html).not.toContain('disabled=""');
  });

  it('shows figures in the display currency and disables the choice for all portfolios', () => {
    const html = screen('summary', {
      portfolioId: null,
      summary: { ...ctx().summary, valueAll: '1361.87', currency: 'USD' },
      data: {
        ...ctx().data,
        display: {
          mode: 'base',
          currency: 'USD',
          baseCurrency: 'USD',
          portfolioCurrency: null,
          fixed: true,
          rates: [],
        },
      },
    });
    expect(html).toContain('1\u00a0361,87\u00a0US$');
    expect(html).toContain('US$');
    expect(html).toContain('disabled=""');
    expect(html).toContain('o total está sempre na moeda base (USD)');
  });

  it('shows no reference to dividends for a portfolio without any', () => {
    const base = ctx();
    const noDividends = {
      data: { ...base.data, hasDividends: false },
      summary: { ...base.summary, divGross: '0', tax: '0', refund: '0' },
    };
    for (const tab of ['summary', 'positions', 'transactions', 'analysis'] as const) {
      const html = screen(tab, noDividends);
      expect(html, tab).not.toMatch(/[Dd]ividend/);
      expect(html, tab).not.toContain('Rendimento passivo');
      expect(html, tab).not.toContain('Impostos retidos');
    }
    // The tab is not in the tab bar, the other four are.
    const summary = screen('summary', noDividends);
    expect(summary).not.toContain('>Dividendos<');
    for (const label of ['Resumo', 'Posições', 'Transações', 'Análise']) {
      expect(summary).toContain(`>${label}<`);
    }
  });

  it('shows the daily gain in the header of every tab and per position', () => {
    for (const tab of ['summary', 'positions', 'transactions'] as const) {
      const html = screen(tab);
      expect(html, tab).toContain('Ganho diário');
      expect(html, tab).toContain('+2,00');
    }
    expect(screen('positions')).toContain('>Hoje<');
    // Nothing is held, so there is no daily gain to show.
    const base = ctx();
    const empty = screen('summary', {
      data: { ...base.data, hasDividends: false, holdings: [], positions: [] },
    });
    expect(empty).not.toContain('Ganho diário');
  });

  it('keeps every dividend figure for a portfolio that has dividends', () => {
    const html = screen('summary');
    expect(html).toContain('Dividendos recebidos');
    expect(html).toContain('Rendimento passivo');
    expect(html).toContain('Dividendos previstos');
    expect(html).toContain('>Dividendos<');
    expect(screen('positions')).toContain('Yield');
    expect(screen('transactions')).toContain('>Dividendos<');
  });

  it('shows no empty "Maiores posições" table for a portfolio with accounts only', () => {
    const base = ctx();
    const html = screen('summary', {
      data: { ...base.data, hasDividends: false, holdings: [], positions: [] },
    });
    expect(html).not.toContain('Maiores posições');
  });
});
