import { describe, expect, it } from 'vitest';

import type { CategoryDto, MovementTotalsDto } from '@nestvault/services';

import {
  budgetRows,
  budgetTotals,
  elapsedPercent,
  filtersToApiQuery,
  filtersToParams,
  isShown,
  monthLabel,
  monthOptions,
  monthShort,
  moveId,
  moveInTotals,
  NO_FILTERS,
  parseFilters,
  parseTab,
  shiftMonth,
} from '../../apps/web/src/lib/expenses-view';

const UUID = '0190f3a2-6b1c-7d2e-8f30-123456789abc';

describe('tab and month', () => {
  it('falls back to the summary for an unknown tab', () => {
    expect(parseTab('movimentos')).toBe('movimentos');
    expect(parseTab('categorias')).toBe('categorias');
    expect(parseTab('x')).toBe('resumo');
    expect(parseTab(undefined)).toBe('resumo');
  });

  it('shifts months across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', -23)).toBe('2024-11');
  });

  it('offers 24 months up to the later of today and the selection', () => {
    const options = monthOptions('2026-03', '2026-10-21');
    expect(options).toHaveLength(24);
    expect(options.at(-1)).toBe('2026-10');
    expect(options[0]).toBe('2024-11');
    expect(monthOptions('2020-01', '2026-10-21')[0]).toBe('2020-01');
    expect(monthOptions('2027-02', '2026-10-21').at(-1)).toBe('2027-02');
  });

  it('labels months in Portuguese', () => {
    expect(monthLabel('2026-10')).toBe('Outubro 2026');
    expect(monthLabel('2026-03')).toBe('Março 2026');
    expect(monthShort('2026-10')).toBe('Out');
    expect(monthLabel('nope')).toBe('nope');
  });

  it('measures how much of the month has gone by', () => {
    expect(elapsedPercent('2026-09', '2026-10-21')).toBe(100);
    expect(elapsedPercent('2026-11', '2026-10-21')).toBe(0);
    expect(elapsedPercent('2026-10', '2026-10-21')).toBe(68);
    expect(elapsedPercent('2026-10', '2026-10-31')).toBe(100);
  });
});

describe('filters in the URL', () => {
  it('round-trips and leaves the defaults out', () => {
    expect(filtersToParams(NO_FILTERS).toString()).toBe('');
    const filters = {
      month: '2026-03',
      accountId: UUID,
      categoryId: 'none',
      kind: 'expense' as const,
      q: ' lidl ',
      withNotes: true,
      showTransfers: false,
    };
    const params = filtersToParams(filters);
    expect(params.toString()).toBe(
      `mes=2026-03&conta=${UUID}&categoria=none&tipo=expense&q=lidl&notas=1&transferencias=0`,
    );
    expect(parseFilters(Object.fromEntries(params))).toEqual({ ...filters, q: 'lidl' });
  });

  it('drops values that are not valid instead of passing them on', () => {
    expect(
      parseFilters({
        mes: '2026-13',
        conta: "1' OR 1=1",
        categoria: 'x',
        tipo: 'drop',
        q: ['a', 'b'],
        notas: '2',
      }),
    ).toEqual({ ...NO_FILTERS, q: 'a' });
  });

  it('builds the API query with the API names', () => {
    const query = filtersToApiQuery({ ...NO_FILTERS, month: '2026-03', withNotes: true, q: 'a&b' });
    expect(query.get('month')).toBe('2026-03');
    expect(query.get('withNotes')).toBe('true');
    expect(query.get('q')).toBe('a&b');
    expect(query.has('kind')).toBe(false);
  });

  it('hides transfers only when asked to', () => {
    expect(isShown('transfer', true)).toBe(true);
    expect(isShown('transfer', false)).toBe(false);
    expect(isShown('expense', false)).toBe(true);
  });
});

const category = (id: string, over: Partial<CategoryDto> = {}): CategoryDto => ({
  id,
  systemKey: null,
  name: id,
  kind: 'expense',
  color: '#fff',
  colorOverride: null,
  global: false,
  monthlyBudget: null,
  hidden: false,
  ...over,
});

describe('budget rows', () => {
  const spent = [
    {
      categoryId: 'a',
      value: '620',
      budget: '700',
      budgetUsed: '0.88',
      previousAverage: '0',
      difference: '0',
    },
    {
      categoryId: 'b',
      value: '60',
      budget: '50',
      budgetUsed: '1.2',
      previousAverage: '0',
      difference: '0',
    },
    {
      categoryId: null,
      value: '5',
      budget: null,
      budgetUsed: null,
      previousAverage: '0',
      difference: '0',
    },
  ];

  it('lists budgeted categories without spending and ranks by spending', () => {
    const rows = budgetRows(
      [
        category('a', { monthlyBudget: '700' }),
        category('b', { monthlyBudget: '50' }),
        category('c', { monthlyBudget: '120' }),
        category('d', { monthlyBudget: '10', hidden: true }),
        category('e'),
        category('f', { kind: 'income', monthlyBudget: '5' }),
      ],
      spent,
    );
    expect(rows.map((row) => row.categoryId)).toEqual(['a', 'b', null, 'c']);
    expect(rows[0]).toMatchObject({ percent: 88.57, remaining: '80.00', tone: 'warn' });
    expect(rows[1]).toMatchObject({ percent: 120, remaining: '-10.00', tone: 'over' });
    expect(rows[2]).toMatchObject({ percent: null, remaining: null, tone: 'ok' });
    expect(rows[3]).toMatchObject({ value: '0', percent: 0, remaining: '120.00' });
  });

  it('totals only the budgeted categories', () => {
    const rows = budgetRows([category('a'), category('b')], spent);
    expect(budgetTotals(rows)).toEqual({ spent: '680.00', budget: '750.00' });
  });
});

const totals = (over: Partial<MovementTotalsDto> = {}): MovementTotalsDto => ({
  income: '100.00',
  expenses: '50.00',
  invested: '0.00',
  transfers: '0.00',
  uncategorized: 2,
  count: 4,
  rates: { USD: '0.5' },
  ...over,
});

describe('moving a movement between totals', () => {
  it('moves an expense to investments', () => {
    const next = moveInTotals(
      totals(),
      { amount: '-10', currency: 'EUR', kind: 'expense', uncategorized: true },
      { kind: 'invest', uncategorized: false },
    );
    expect(next).toMatchObject({ expenses: '40.00', invested: '10.00', uncategorized: 1 });
  });

  it('converts a foreign currency with the rates of the totals', () => {
    const next = moveInTotals(
      totals(),
      { amount: '-10', currency: 'USD', kind: 'expense', uncategorized: false },
      { kind: 'income', uncategorized: false },
    );
    // 10 USD = 5 EUR: leaves the expenses, enters the income as a negative amount
    expect(next).toMatchObject({ expenses: '45.00', income: '95.00' });
  });

  it('counts only the inflow of a transfer', () => {
    const out = moveInTotals(
      totals(),
      { amount: '-10', currency: 'EUR', kind: 'expense', uncategorized: false },
      { kind: 'transfer', uncategorized: false },
    );
    expect(out).toMatchObject({ expenses: '40.00', transfers: '0.00' });
    const inflow = moveInTotals(
      totals(),
      { amount: '10', currency: 'EUR', kind: 'income', uncategorized: false },
      { kind: 'transfer', uncategorized: false },
    );
    expect(inflow).toMatchObject({ income: '90.00', transfers: '10.00' });
  });

  it('does not let the uncategorized count go below zero', () => {
    const next = moveInTotals(
      totals({ uncategorized: 0 }),
      { amount: '-1', currency: 'EUR', kind: 'expense', uncategorized: true },
      { kind: 'expense', uncategorized: false },
    );
    expect(next.uncategorized).toBe(0);
  });
});

describe('moveId', () => {
  it('moves an item to the place of another', () => {
    expect(moveId(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveId(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('ignores moves that go nowhere', () => {
    expect(moveId(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveId(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(moveId(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
  });
});
