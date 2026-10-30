import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EventsTab } from '@webapp/components/real-estate/events-tab';
import { InstallmentsTab } from '@webapp/components/real-estate/installments-tab';
import { PropertyScreen } from '@webapp/components/real-estate/property-screen';
import { SaleSimulatorTab } from '@webapp/components/real-estate/sale-simulator-tab';
import { WorksTab } from '@webapp/components/real-estate/works-tab';
import {
  camelKey,
  installmentRows,
  loanFacts,
  propertyFigures,
  ratesSince,
  summarizeInstallments,
  yearBars,
  yearPeriod,
  DEFAULT_CPI,
} from '@webapp/lib/real-estate-view';
import type { LoanBundle, PropertyPageData } from '@webapp/server/real-estate';

import messages from '../../apps/web/messages/pt-PT.json';
import { NextIntlClientProvider } from '../../apps/web/node_modules/next-intl';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-PT" messages={messages} timeZone="Europe/Lisbon">
      {node}
    </NextIntlClientProvider>,
  ).replace(/[\u00a0\u202f]/g, ' ');

const ID = '0192f3a1-0000-7000-8000-000000000001';

const property = {
  id: ID,
  name: 'Apartamento T3',
  type: 'primary_home',
  address: null,
  purchaseDate: '2020-09-01',
  purchasePrice: '124000',
  downPayment: '12400',
  costs: {
    deed: '915',
    imt: '0',
    stampDuty: '0',
    registration: '0',
    bankFees: '0',
    total: '2559.71',
  },
  loanAmount: '111600',
  sellingCostPct: '5',
  includeInNetWorth: true,
  holders: [{ holderId: ID, sharePct: '100' }],
  latestValuation: {
    id: ID,
    propertyId: ID,
    date: '2026-09-01',
    value: '250000',
    source: 'manual',
  },
};

const row = (
  number: number,
  source: 'actual' | 'projected',
  capital: string,
  interest: string,
) => ({
  number,
  dueDate: `2020-${String(number + 9).padStart(2, '0')}-01`,
  capital,
  interest,
  payment: (Number(capital) + Number(interest)).toFixed(2),
  balanceAfter: '100000',
  annualRate: '2.4',
  source,
});

const bundle = {
  loan: {
    id: ID,
    name: 'Crédito habitação',
    kind: 'mortgage',
    propertyId: ID,
    principal: '111600',
    startDate: '2020-09-01',
    firstDueDate: '2020-10-01',
    termMonths: 480,
    rateType: 'variable',
    rateIndex: 'euribor_6m',
    spread: '0.5',
    annualRate: '2.4',
    fixedUntil: null,
    reviewMonths: 6,
    paymentDay: 1,
    debitAccountId: null,
    taeg: null,
    tan: null,
    fields: [],
    paid: {
      count: 2,
      capital: '100',
      interest: '50',
      fields: { lifeInsurance: '10', fees: '2' },
      total: '162',
      costOfCredit: '62',
    },
    prepaid: '15000',
    outstanding: '86088.28',
    remainingInstallments: 478,
  },
  schedule: {
    schedule: [
      row(1, 'actual', '50', '25'),
      row(2, 'actual', '50', '25'),
      row(3, 'projected', '51', '24'),
      row(4, 'projected', '52', '23'),
    ],
    byYear: [
      {
        year: 1,
        count: 2,
        capital: '100',
        interest: '50',
        fields: { lifeInsurance: '10', fees: '2' },
        total: '162',
        costOfCredit: '62',
      },
    ],
  },
  installments: [
    { id: ID, loanId: ID, number: 1, capital: '50', interest: '25', total: '81' },
    { id: ID, loanId: ID, number: 2, capital: '50', interest: '25', total: '81' },
  ],
  events: [
    {
      id: ID,
      loanId: ID,
      kind: 'rate_review',
      date: '2021-09-01',
      effectiveFrom: '2021-09-01',
      amount: null,
      fee: null,
      effect: null,
      indexValue: null,
      spread: null,
      annualRate: '2.4',
      newInstallment: null,
      termMonths: null,
      impact: {
        number: 3,
        paymentBefore: '75',
        paymentAfter: '80',
        remainingBefore: 478,
        remainingAfter: 478,
        annualRateBefore: '4.1',
        annualRateAfter: '2.4',
      },
    },
  ],
  review: null,
} as unknown as LoanBundle;

const works = {
  projects: [],
  byProperty: [
    {
      propertyId: ID,
      projects: 0,
      byStatus: { planned: 0, in_progress: 0, done: 0 },
      budget: '0',
      paid: '0',
      outstanding: '0',
    },
  ],
};

describe('real estate view', () => {
  it('turns snake_case values into message keys', () => {
    expect(camelKey('primary_home')).toBe('primaryHome');
    expect(camelKey('euribor_3m')).toBe('euribor3m');
    expect(camelKey('garage')).toBe('garage');
  });

  it('counts prepayments in the capital paid and the equity from the latest valuation', () => {
    const figures = propertyFigures(property as never, [bundle], works);
    expect(figures.capitalPaid).toBe('15100');
    expect(figures.equity).toBe('163911.72');
    expect(figures.spent.totalInvested).toBe('30059.71');
    // insurances and the other fields are grouped as the donut groups them
    expect(figures.spent.slices.find((s) => s.key === 'insurances')?.amount).toBe('10');
    expect(figures.spent.slices.find((s) => s.key === 'feesAndTax')?.amount).toBe('2');
    expect(figures.paidCount).toBe(2);
    expect(figures.totalCount).toBe(480);
  });

  it('has no equity without a valuation', () => {
    const figures = propertyFigures(
      { ...property, latestValuation: null } as never,
      [bundle],
      null,
    );
    expect(figures.equity).toBeNull();
    expect(figures.value).toBeNull();
  });

  it('reads the loan facts and carries the extras into the projection', () => {
    const facts = loanFacts(bundle);
    expect(facts.payment).toBe('81');
    expect(facts.upcoming.map((u) => u.total)).toEqual(['81', '81']);
    expect(facts.upcoming[0]?.extras).toBe('6');
    expect(facts.nextDueDate).toBe('2020-12-01');
  });

  it('groups the schedule by contract year and marks projections', () => {
    const bars = yearBars(bundle);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ year: 1, capital: 203, interest: 97, projected: false });
    expect(yearPeriod('2020-09-01', 2)).toEqual({ from: '2021-09', to: '2022-08' });
  });

  it('lists installments, entered first, with what is left and summarises a filter', () => {
    const rows = installmentRows(bundle);
    expect(rows.map((r) => r.status)).toEqual(['paid', 'paid', 'projected', 'projected']);
    expect(rows.map((r) => r.remaining)).toEqual([3, 2, 1, 0]);
    const projected = summarizeInstallments(rows.filter((r) => r.status === 'projected'));
    expect(projected).toMatchObject({ paid: 0, projected: 2, capital: '103', interest: '47' });
  });

  it('only applies the price index after the purchase year', () => {
    expect(ratesSince(DEFAULT_CPI, '2020-09-01')).toHaveLength(5);
    expect(ratesSince(DEFAULT_CPI, '2024-01-01').map((r) => r.year)).toEqual([2025]);
  });
});

describe('PropertyScreen', () => {
  const data = {
    property,
    bundles: [bundle],
    works,
    costs: [],
    holders: [{ id: ID, name: 'Rui', color: '#9D6BFF' }],
  } as unknown as PropertyPageData;

  it('renders the five tabs and the summary of the first one', () => {
    const html = wrap(<PropertyScreen data={data} today="2026-10-30" />);
    for (const tab of ['Resumo', 'Prestações', 'Eventos e anos', 'Obras', 'Venda e simulador']) {
      expect(html).toContain(tab);
    }
    expect(html).toContain('Casa de morada');
    expect(html).toContain('Rui 100%');
    expect(html).toContain('163 911,72 €');
    expect(html).toContain('2 de 480 prestações');
  });

  it('renders the other tabs', () => {
    const figures = propertyFigures(property as never, [bundle], works);
    const sale = wrap(
      <SaleSimulatorTab property={property as never} figures={figures} bundle={bundle} />,
    );
    expect(sale).toContain('Análise de venda');
    expect(sale).toContain('Preço de equilíbrio');
    expect(sale).toContain('compostas');
    expect(sale).toContain('Simulador');
    const installments = wrap(<InstallmentsTab bundle={bundle} today="2020-10-30" />);
    expect(installments).toContain('Projetada');
    expect(installments).toContain('Paga');
    const events = wrap(<EventsTab bundle={bundle} />);
    expect(events).toContain('Revisão da taxa');
    expect(events).toContain('Taxa 4,10% → 2,40%');
    expect(events).toContain('Contrato do crédito');
    const worksTab = wrap(<WorksTab works={works} propertyId={ID} />);
    expect(worksTab).toContain('Ainda não há obras neste imóvel');
  });

  it('renders without a loan', () => {
    const html = wrap(<PropertyScreen data={{ ...data, bundles: [] }} today="2026-10-30" />);
    expect(html).toContain('Sem empréstimo associado a este imóvel.');
  });
});
