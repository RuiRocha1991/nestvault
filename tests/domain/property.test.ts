import { describe, expect, it } from 'vitest';

import {
  acquisitionCostsTotal,
  latestValuation,
  loanAmount,
  purchaseOutlay,
  sharesAddUpTo100,
} from '@nestvault/domain';

// The reference property of the owner's spreadsheet (docs/handoff.md, PRD "Real estate and loans").
const REFERENCE_COSTS = {
  deed: '915',
  imt: '631.86',
  stampDuty: '992',
  registration: '0',
  bankFees: '20.85',
};

describe('acquisition costs', () => {
  it('adds the itemized costs of the reference property to 2 559,71 €', () => {
    expect(acquisitionCostsTotal(REFERENCE_COSTS)).toBe('2559.71');
  });

  it('is exact where floats are not (0.1 + 0.2)', () => {
    expect(
      acquisitionCostsTotal({
        deed: '0.1',
        imt: '0.2',
        stampDuty: '0',
        registration: '0',
        bankFees: '0',
      }),
    ).toBe('0.3');
  });

  it('is zero without any cost', () => {
    expect(
      acquisitionCostsTotal({
        deed: '0',
        imt: '0',
        stampDuty: '0',
        registration: '0',
        bankFees: '0',
      }),
    ).toBe('0');
  });
});

describe('loan and outlay', () => {
  it('lends 111 600 € for a 124 000 € price with a 12 400 € down payment', () => {
    expect(loanAmount('124000', '12400')).toBe('111600');
  });

  it('adds the costs to the price: 126 559,71 €', () => {
    expect(purchaseOutlay('124000', REFERENCE_COSTS)).toBe('126559.71');
  });
});

describe('latestValuation', () => {
  const at = (date: string, value: string) => ({ date, value });

  it('takes the newest date whatever the order', () => {
    const list = [
      at('2023-01-01', '130000'),
      at('2025-06-30', '150000'),
      at('2024-03-01', '140000'),
    ];
    expect(latestValuation(list)).toEqual(at('2025-06-30', '150000'));
  });

  it('returns undefined without valuations', () => {
    expect(latestValuation<{ date: string; value: string }>([])).toBeUndefined();
  });

  it('lets the one added last win a tie on the date', () => {
    expect(latestValuation([at('2024-01-01', '1'), at('2024-01-01', '2')])).toEqual(
      at('2024-01-01', '2'),
    );
  });
});

describe('sharesAddUpTo100', () => {
  it.each([
    [['100'], true],
    [['50', '50'], true],
    [['33.3333', '33.3333', '33.3334'], true],
    [['50', '49.99'], false],
    [['60', '60'], false],
    [[], false],
  ])('%j → %s', (shares, expected) => {
    expect(sharesAddUpTo100(shares)).toBe(expected);
  });
});
