import { describe, expect, it } from 'vitest';

import {
  breakEvenPrice,
  compoundInflation,
  euriborSensitivity,
  paceToGoal,
  realAppreciation,
  repaidPct,
  saleAnalysis,
  simulatePayoff,
  spentBreakdown,
} from '@nestvault/domain';

// Reference case of the spreadsheet (FR "Real estate and loans").
const spent = spentBreakdown({
  downPayment: '12400',
  capitalPaid: '25511.72',
  works: '22071.46',
  interest: '14058.99',
  insurances: '2696.87',
  acquisitionCosts: '2559.71',
  feesAndTax: '97.24',
});

describe('spentBreakdown', () => {
  it('reproduces the totals of the reference case', () => {
    expect(spent.totalInvested).toBe('62542.89');
    expect(spent.costOfCredit).toBe('16853.1');
    expect(spent.totalSpent).toBe('79395.99');
  });

  it('gives each slice its share', () => {
    expect(spent.slices.find((s) => s.key === 'capitalPaid')?.pct).toBe('32.1');
    expect(spent.slices.find((s) => s.key === 'works')?.pct).toBe('27.8');
  });

  it('shows 0 shares when nothing was spent', () => {
    const empty = spentBreakdown({
      downPayment: 0,
      capitalPaid: 0,
      works: 0,
      interest: 0,
      insurances: 0,
      acquisitionCosts: 0,
      feesAndTax: 0,
    });
    expect(empty.slices.every((s) => s.pct === '0')).toBe(true);
  });
});

describe('repaidPct', () => {
  it('is capital paid over the principal', () => {
    expect(repaidPct('111600', '25511.72')).toBe('22.9');
    expect(repaidPct('0', '10')).toBe('0');
  });
});

describe('saleAnalysis and breakEvenPrice', () => {
  const base = { debt: '86088.28', sellingCostPct: '5', totalSpent: spent.totalSpent };

  it('computes the net proceeds and the gain', () => {
    expect(saleAnalysis({ ...base, price: '250000' })).toEqual({
      sellingCosts: '12500',
      netProceeds: '151411.72',
      gain: '72015.73',
    });
  });

  it('shows a loss as negative', () => {
    expect(saleAnalysis({ ...base, price: '150000' }).gain.startsWith('-')).toBe(true);
  });

  it('finds the price where the gain is zero', () => {
    const price = breakEvenPrice(base);
    expect(price).toBe('174193.97');
    expect(Number(saleAnalysis({ ...base, price: price ?? '0' }).gain)).toBeCloseTo(0, 1);
  });

  it('has no break-even when the selling costs take the whole price', () => {
    expect(breakEvenPrice({ ...base, sellingCostPct: '100' })).toBeNull();
  });
});

describe('compoundInflation', () => {
  const rates = [
    { year: 2023, ratePct: '4.30' },
    { year: 2021, ratePct: '1.27' },
    { year: 2022, ratePct: '7.83' },
    { year: 2024, ratePct: '2.40' },
    { year: 2025, ratePct: '2.30' },
  ];

  it('compounds the yearly rates instead of summing them', () => {
    const result = compoundInflation(rates);
    expect(result.compoundedPct).toBe('19.3');
    expect(result.summedPct).toBe('18.1');
    expect(result.rows.map((r) => r.year)).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(result.rows.map((r) => r.index)).toEqual([
      '1.0127',
      '1.092',
      '1.139',
      '1.1663',
      '1.1931',
    ]);
  });

  it('is 1 without rates', () => {
    expect(compoundInflation([]).factor).toBe('1');
  });

  it('adjusts the purchase price', () => {
    const { factor } = compoundInflation(rates);
    const result = realAppreciation('124000', '250000', factor);
    expect(result?.nominalPct).toBe('101.6');
    expect(result?.realPct).toBe('69');
    expect(Number(result?.adjustedPrice)).toBeCloseTo(147945.58, 0);
    expect(realAppreciation('0', '1', factor)).toBeNull();
  });
});

describe('paceToGoal', () => {
  it('counts the installments paid against the goal', () => {
    expect(paceToGoal('111600', '25511.72', 73, 20)).toEqual({
      goalPerMonth: '465',
      paidPerMonth: '349.48',
      idealPaid: '33945',
      difference: '-8433.28',
      ahead: false,
    });
  });

  it('is ahead when more was repaid than the goal asks', () => {
    expect(paceToGoal('120000', '50000', 12, 10).ahead).toBe(true);
  });

  it('handles no installments paid yet', () => {
    expect(paceToGoal('120000', '0', 0, 10).paidPerMonth).toBe('0');
  });
});

describe('simulatePayoff', () => {
  const loan = {
    balance: '86088.28',
    currentRatePct: '2.4',
    remainingMonths: 384,
    nextDueDate: '2026-10-01',
    spreadPct: '0.5',
    euriborPct: '1.9',
  };

  it('without changes the simulation equals the current plan', () => {
    const result = simulatePayoff(loan);
    expect(result.simulated).toEqual(result.current);
    expect(result.extraPerMonth).toBe('0');
    expect(result.interestSaved).toBe('0');
    expect(result.current.endDate).toBe('2058-09-01');
    expect(result.current.installments).toBe(384);
  });

  it('finishing in 20 years asks for the installment of the mockup', () => {
    const result = simulatePayoff({ ...loan, finishInYears: 20 });
    expect(Number(result.current.payment)).toBeCloseTo(321.4, 0);
    expect(Number(result.simulated.payment)).toBeCloseTo(452, 0);
    expect(result.simulated.endDate).toBe('2046-09-01');
    expect(Number(result.extraPerMonth)).toBeCloseTo(130.6, 0);
    expect(Number(result.interestSaved)).toBeGreaterThan(14000);
  });

  it('a prepayment that reduces the term ends sooner', () => {
    const result = simulatePayoff({
      ...loan,
      prepayment: { amount: '10000', date: '2026-10-01', effect: 'reduce_term' },
    });
    expect(result.simulated.installments).toBeLessThan(384);
    expect(Number(result.interestSaved)).toBeGreaterThan(0);
  });

  it('a prepayment that reduces the installment keeps the term', () => {
    const result = simulatePayoff({
      ...loan,
      prepayment: { amount: '10000', date: '2026-10-01', effect: 'reduce_installment' },
    });
    expect(result.simulated.installments).toBe(384);
    expect(Number(result.extraPerMonth)).toBeLessThan(0);
  });

  it('a higher index raises the installment', () => {
    const result = simulatePayoff({ ...loan, euriborPct: '3.9' });
    expect(result.rate).toBe('4.4');
    expect(Number(result.extraPerMonth)).toBeGreaterThan(0);
    expect(Number(result.interestSaved)).toBeLessThan(0);
  });

  it('never goes below a zero rate', () => {
    expect(simulatePayoff({ ...loan, euriborPct: '-2' }).rate).toBe('0');
  });

  it('has nothing to pay once the balance is zero', () => {
    expect(simulatePayoff({ ...loan, balance: '0' }).current.endDate).toBeNull();
  });
});

describe('euriborSensitivity', () => {
  it('lists the installment for a higher index', () => {
    const rows = euriborSensitivity(
      {
        balance: '86088.28',
        currentRatePct: '2.4',
        remainingMonths: 384,
        spreadPct: '0.5',
        euriborPct: '1.9',
      },
      [0, 1, 2],
    );
    expect(rows.map((r) => r.ratePct)).toEqual(['2.4', '3.4', '4.4']);
    expect(rows[0]?.difference).toBe('0');
    expect(Number(rows[1]?.payment)).toBeCloseTo(368.13, 0);
    expect(Number(rows[2]?.payment)).toBeCloseTo(418.23, 0);
  });
});
