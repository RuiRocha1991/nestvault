import { describe, expect, it } from 'vitest';

import {
  buildEventSchedule,
  buildSchedule,
  defaultEffectiveFrom,
  frenchPayment,
  monthsToPayOff,
  nextReviewDate,
  projectLoan,
  reviewedRate,
  reviewPreview,
  type LoanEvent,
} from '@nestvault/domain';

// 10 000 € at 12 % over 12 months: payment 888,49; after installment 3 the balance is 7 610,80.
const BASE = { balance: '10000', annualPct: '12', months: 12, firstDueDate: '2024-01-05' };

describe('without events', () => {
  it('is the plain French schedule', () => {
    const { rows } = buildEventSchedule({
      balance: '111600',
      annualPct: '1.5',
      months: 480,
      firstDueDate: '2020-10-05',
    });
    const plain = buildSchedule({
      balance: '111600',
      annualPct: '1.5',
      months: 480,
      firstDueDate: '2020-10-05',
    });
    expect(rows).toHaveLength(480);
    expect(
      rows.map(({ number, dueDate, capital, interest, balanceAfter }) => ({
        number,
        dueDate,
        capital,
        interest,
        balanceAfter,
      })),
    ).toEqual(
      plain.map(({ number, dueDate, capital, interest, balanceAfter }) => ({
        number,
        dueDate,
        capital,
        interest,
        balanceAfter,
      })),
    );
  });
});

describe('prepayment', () => {
  const prepay = (effect: 'reduce_installment' | 'reduce_term'): LoanEvent => ({
    kind: 'prepayment',
    effectiveFrom: '2024-04-01',
    amount: '2000',
    effect,
  });

  it('reducing the installment keeps the term and lowers the payment from the next installment', () => {
    const { rows, impacts } = buildEventSchedule({
      ...BASE,
      events: [prepay('reduce_installment')],
    });
    expect(rows).toHaveLength(12);
    expect(rows[2]?.balanceAfter).toBe('7610.8');
    // 5 610,80 over the 9 left.
    const lower = frenchPayment('5610.8', '12', 9);
    expect(rows[3]).toMatchObject({ number: 4, interest: '56.11' });
    expect(Number(rows[3]?.payment)).toBeCloseTo(Number(lower), 2);
    expect(Number(lower)).toBeLessThan(888.49);
    expect(rows.at(-1)?.balanceAfter).toBe('0');
    expect(impacts).toEqual([
      expect.objectContaining({
        number: 4,
        balanceBefore: '7610.8',
        paymentBefore: '888.49',
        paymentAfter: lower,
        remainingBefore: 9,
        remainingAfter: 9,
      }),
    ]);
  });

  it('reducing the term keeps the payment and ends sooner', () => {
    const { rows, impacts } = buildEventSchedule({ ...BASE, events: [prepay('reduce_term')] });
    // 5 610,80 at 888,49: seven more installments, the last one smaller.
    expect(rows).toHaveLength(10);
    expect(rows[3]?.payment).toBe('888.49');
    expect(Number(rows.at(-1)?.payment)).toBeLessThan(888.49);
    expect(rows.at(-1)?.balanceAfter).toBe('0');
    expect(impacts[0]).toMatchObject({
      paymentBefore: '888.49',
      paymentAfter: '888.49',
      remainingBefore: 9,
      remainingAfter: 7,
    });
  });

  it('paying off everything ends the loan at that point', () => {
    const { rows } = buildEventSchedule({
      ...BASE,
      events: [
        {
          kind: 'prepayment',
          effectiveFrom: '2024-04-01',
          amount: '999999',
          effect: 'reduce_term',
        },
      ],
    });
    expect(rows).toHaveLength(3);
  });
});

describe('rate review and renegotiation', () => {
  it('a review recomputes the installment at the new rate over the installments left', () => {
    const { rows, impacts } = buildEventSchedule({
      ...BASE,
      events: [{ kind: 'rate_review', effectiveFrom: '2024-04-05', annualPct: '6' }],
    });
    const expected = frenchPayment('7610.8', '6', 9);
    expect(rows[2]?.annualPct).toBe('12');
    expect(rows[3]).toMatchObject({ annualPct: '6', interest: '38.05' });
    expect(Number(rows[3]?.payment)).toBeCloseTo(Number(expected), 2);
    expect(impacts[0]).toMatchObject({
      annualPctBefore: '12',
      annualPctAfter: '6',
      paymentAfter: expected,
    });
  });

  it('uses the installment the bank announced and lets it set the term', () => {
    const { rows, impacts } = buildEventSchedule({
      ...BASE,
      events: [
        {
          kind: 'rate_review',
          effectiveFrom: '2024-04-05',
          annualPct: '6',
          newInstallment: '1000',
        },
      ],
    });
    expect(rows[3]?.payment).toBe('1000');
    expect(rows.length).toBeLessThan(12);
    expect(impacts[0]?.remainingAfter).toBe(monthsToPayOff('7610.8', '6', '1000'));
  });

  it('a renegotiation changes the rate and the installments left together', () => {
    const { rows } = buildEventSchedule({
      ...BASE,
      events: [
        { kind: 'renegotiation', effectiveFrom: '2024-04-05', annualPct: '3', termMonths: 24 },
      ],
    });
    expect(rows).toHaveLength(3 + 24);
    expect(rows[3]?.annualPct).toBe('3');
    expect(rows.at(-1)?.balanceAfter).toBe('0');
  });

  it('applies events in date order whatever the order given', () => {
    const early: LoanEvent = { kind: 'rate_review', effectiveFrom: '2024-03-05', annualPct: '8' };
    const late: LoanEvent = { kind: 'rate_review', effectiveFrom: '2024-06-05', annualPct: '4' };
    const forward = buildEventSchedule({ ...BASE, events: [early, late] }).rows;
    const reversed = buildEventSchedule({ ...BASE, events: [late, early] }).rows;
    expect(reversed).toEqual(forward);
    expect(forward.map((row) => row.annualPct).slice(0, 7)).toEqual([
      '12',
      '12',
      '8',
      '8',
      '8',
      '4',
      '4',
    ]);
  });

  it('refuses an installment that does not cover the interest', () => {
    expect(() =>
      buildEventSchedule({
        ...BASE,
        events: [
          {
            kind: 'rate_review',
            effectiveFrom: '2024-04-05',
            annualPct: '6',
            newInstallment: '10',
          },
        ],
      }),
    ).toThrow(RangeError);
  });
});

describe('the reference loan: 111 600 € over 480 months at 1,5 %', () => {
  const loan = { balance: '111600', annualPct: '1.5', months: 480, firstDueDate: '2020-10-05' };
  const prepayment: LoanEvent = {
    kind: 'prepayment',
    effectiveFrom: '2023-03-01',
    amount: '15000',
    effect: 'reduce_installment',
  };

  it('a 15 000 € prepayment on 01/02/2023 is felt from the 03/2023 installment (number 30)', () => {
    const plain = buildEventSchedule(loan).rows;
    const { rows, impacts } = buildEventSchedule({ ...loan, events: [prepayment] });
    expect(plain[29]?.dueDate).toBe('2023-03-05');
    expect(rows.slice(0, 29)).toEqual(plain.slice(0, 29));
    expect(rows[29]?.dueDate).toBe('2023-03-05');
    expect(Number(rows[29]?.payment)).toBeLessThan(Number(plain[29]?.payment));
    expect(impacts[0]).toMatchObject({ number: 30, remainingBefore: 451, remainingAfter: 451 });
    expect(rows.at(-1)?.balanceAfter).toBe('0');
    // 15 000 € less capital means less interest over the life of the loan.
    const interest = (list: typeof rows) =>
      list.reduce((total, row) => total + Number(row.interest), 0);
    expect(interest(rows)).toBeLessThan(interest(plain));
  });

  it('projectLoan carries a past prepayment and review into what is left', () => {
    const actual = buildEventSchedule({ ...loan, events: [prepayment] }).rows.slice(0, 40);
    const result = projectLoan({
      principal: '111600',
      annualPct: '1.5',
      termMonths: 480,
      firstDueDate: '2020-10-05',
      events: [prepayment],
      actual: actual.map(({ number, dueDate, capital, interest }) => ({
        number,
        dueDate,
        capital,
        interest,
      })),
    });
    const replay = buildEventSchedule({ ...loan, events: [prepayment] }).rows;
    expect(result.rows).toHaveLength(replay.length);
    expect(result.rows.filter((row) => row.source === 'actual')).toHaveLength(40);
    expect(result.rows[40]).toMatchObject({ number: 41, source: 'projected' });
    expect(result.outstanding).toBe(actual[39]?.balanceAfter);
    expect(result.rows.at(-1)?.balanceAfter).toBe('0');
  });

  it('projectLoan applies an event dated after the last installment paid', () => {
    const actual = buildEventSchedule(loan).rows.slice(0, 12);
    const review: LoanEvent = { kind: 'rate_review', effectiveFrom: '2022-01-05', annualPct: '3' };
    const result = projectLoan({
      principal: '111600',
      annualPct: '1.5',
      termMonths: 480,
      firstDueDate: '2020-10-05',
      events: [review],
      actual: actual.map(({ number, dueDate, capital, interest }) => ({
        number,
        dueDate,
        capital,
        interest,
      })),
    });
    // Installment 16 is due 2022-01-05, the first one at the new rate.
    expect(result.rows[14]?.annualPct).toBe('1.5');
    expect(result.rows[15]).toMatchObject({ number: 16, annualPct: '3', source: 'projected' });
  });

  it('projects a loan with no installments entered from the principal', () => {
    const result = projectLoan({
      principal: '111600',
      annualPct: '1.5',
      termMonths: 480,
      firstDueDate: '2020-10-05',
      events: [],
      actual: [],
    });
    expect(result.rows).toHaveLength(480);
    expect(result.outstanding).toBe('111600');
    expect(result.rows.every((row) => row.source === 'projected')).toBe(true);
  });
});

describe('projectLoan with events still to come', () => {
  it('applies a future term-reducing prepayment once, not twice', () => {
    // 1 200 € at 0 % over 12 months; one installment paid; 300 € prepaid later to shorten the term.
    const result = projectLoan({
      principal: '1200',
      annualPct: '0',
      termMonths: 12,
      firstDueDate: '2020-10-05',
      events: [
        { kind: 'prepayment', effectiveFrom: '2020-12-01', amount: '300', effect: 'reduce_term' },
      ],
      actual: [{ number: 1, dueDate: '2020-10-05', capital: '100', interest: '0' }],
    });
    // 1 100 € left: two installments of 100 €, then 300 € off, then 600 € at 100 € = six more.
    expect(result.rows).toHaveLength(9);
    expect(result.rows.at(-1)?.balanceAfter).toBe('0');
    expect(result.rows[1]?.payment).toBe('100');
  });
});

describe('review preview', () => {
  it('adds the spread to the index and never goes below zero', () => {
    expect(reviewedRate('2.5', '1')).toBe('3.5');
    expect(reviewedRate('-0.5', '0.3')).toBe('0');
  });

  it('shows the installment at the new rate over what is left', () => {
    expect(reviewPreview('7610.8', '6', 9)).toBe(frenchPayment('7610.8', '6', 9));
  });
});

describe('dates of an event', () => {
  it('a prepayment is felt from the first day of the next month', () => {
    expect(defaultEffectiveFrom('prepayment', '2023-02-01')).toBe('2023-03-01');
    expect(defaultEffectiveFrom('prepayment', '2023-12-31')).toBe('2024-01-01');
    expect(defaultEffectiveFrom('rate_review', '2023-03-05')).toBe('2023-03-05');
    expect(defaultEffectiveFrom('renegotiation', '2023-10-01')).toBe('2023-10-01');
  });

  it('finds the next review after today', () => {
    expect(nextReviewDate('2023-03-05', 6, '2026-10-30')).toBe('2027-03-05');
    expect(nextReviewDate('2026-03-05', 12, '2026-03-05')).toBe('2027-03-05');
    expect(nextReviewDate('2027-01-01', 6, '2026-10-30')).toBe('2027-01-01');
    expect(nextReviewDate('2023-03-05', null, '2026-10-30')).toBeNull();
  });
});
