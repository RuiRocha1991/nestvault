import { describe, expect, it } from 'vitest';

import { xirr } from '@nestvault/domain';

describe('xirr', () => {
  it('10 % for 1000 in and 1100 out exactly one year later', () => {
    const rate = xirr([
      { date: '2025-01-01', amount: '-1000' },
      { date: '2026-01-01', amount: '1100' },
    ]);
    expect(rate).toBeCloseTo(0.1, 6);
  });

  it('matches the spreadsheet XIRR with an uneven second outflow', () => {
    const rate = xirr([
      { date: '2025-01-01', amount: '-1000' },
      { date: '2025-07-01', amount: '-500' },
      { date: '2026-01-01', amount: '1700' },
    ]);
    expect(rate).toBeCloseTo(0.1609358496, 6);
  });

  it('matches the spreadsheet XIRR for twelve monthly contributions', () => {
    const flows = Array.from({ length: 12 }, (_, i) => ({
      date: `2025-${String(i + 1).padStart(2, '0')}-01`,
      amount: '-100',
    }));
    flows.push({ date: '2026-01-01', amount: '1300' });
    expect(xirr(flows)).toBeCloseTo(0.1566983509, 6);
  });

  it('sorts unsorted flows', () => {
    const rate = xirr([
      { date: '2026-01-01', amount: '1100' },
      { date: '2025-01-01', amount: '-1000' },
    ]);
    expect(rate).toBeCloseTo(0.1, 6);
  });

  it('is negative for a loss', () => {
    expect(
      xirr([
        { date: '2025-01-01', amount: '-1000' },
        { date: '2026-01-01', amount: '900' },
      ]),
    ).toBeCloseTo(-0.1, 6);
  });

  it('is NaN with fewer than two flows', () => {
    expect(xirr([])).toBeNaN();
    expect(xirr([{ date: '2025-01-01', amount: '-1000' }])).toBeNaN();
  });

  it('is NaN without both an outflow and an inflow', () => {
    expect(
      xirr([
        { date: '2025-01-01', amount: '-1000' },
        { date: '2026-01-01', amount: '-5' },
      ]),
    ).toBeNaN();
    expect(
      xirr([
        { date: '2025-01-01', amount: '1000' },
        { date: '2026-01-01', amount: '5' },
      ]),
    ).toBeNaN();
  });

  it('is NaN when the history spans less than 30 days', () => {
    expect(
      xirr([
        { date: '2025-01-01', amount: '-1000' },
        { date: '2025-01-30', amount: '1100' },
      ]),
    ).toBeNaN();
    expect(
      xirr([
        { date: '2025-01-01', amount: '-1000' },
        { date: '2025-01-31', amount: '1100' },
      ]),
    ).not.toBeNaN();
  });

  it('is NaN when the rate is outside [-99 %, 1000 %]', () => {
    expect(
      xirr([
        { date: '2025-01-01', amount: '-1' },
        { date: '2025-02-15', amount: '100000' },
      ]),
    ).toBeNaN();
  });
});
