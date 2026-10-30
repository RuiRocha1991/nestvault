import { describe, expect, it } from 'vitest';

import {
  buildSchedule,
  contractYear,
  DEFAULT_ENABLED_LOAN_FIELDS,
  dec,
  expenseSplit,
  frenchPayment,
  installmentTotal,
  mergeSchedule,
  outstandingBalance,
  periodTotals,
  remainingInstallments,
  sum,
  totalsByContractYear,
  totalsOf,
  type InstallmentAmounts,
  type LoanFieldSetting,
} from '@nestvault/domain';

const on = (key: string, countsAsExpense = true): LoanFieldSetting => ({
  key,
  enabled: true,
  countsAsExpense,
});
const off = (key: string): LoanFieldSetting => ({ key, enabled: false, countsAsExpense: true });

describe('frenchPayment', () => {
  it('10 000 € at 12 % over 12 months: 888,49 €', () => {
    expect(frenchPayment('10000', '12', 12)).toBe('888.49');
  });

  it('splits the balance evenly at a zero rate', () => {
    expect(frenchPayment('1200', '0', 12)).toBe('100');
  });

  it('rejects a term below one month', () => {
    expect(() => frenchPayment('1000', '3', 0)).toThrow(RangeError);
  });
});

describe('buildSchedule', () => {
  const table = buildSchedule({
    balance: '10000',
    annualPct: '12',
    months: 12,
    firstDueDate: '2025-01-05',
  });

  it('follows a table worked out by hand (interest in cents, half up)', () => {
    expect(table.slice(0, 3)).toEqual([
      {
        number: 1,
        dueDate: '2025-01-05',
        capital: '788.49',
        interest: '100',
        payment: '888.49',
        balanceAfter: '9211.51',
      },
      {
        number: 2,
        dueDate: '2025-02-05',
        capital: '796.37',
        interest: '92.12',
        payment: '888.49',
        balanceAfter: '8415.14',
      },
      {
        number: 3,
        dueDate: '2025-03-05',
        capital: '804.34',
        interest: '84.15',
        payment: '888.49',
        balanceAfter: '7610.8',
      },
    ]);
  });

  it('repays exactly the balance: the capital adds up to it and the last balance is 0', () => {
    expect(sum(table.map((row) => row.capital)).toString()).toBe('10000');
    expect(table.at(-1)?.balanceAfter).toBe('0');
    expect(table).toHaveLength(12);
  });

  it('absorbs the rounding in the last installment (within a few cents of the others)', () => {
    const last = dec(table.at(-1)?.payment ?? 0);
    expect(last.minus('888.49').abs().lte('0.10')).toBe(true);
  });

  it('splits 1 000 € in three at zero rate as 333,33 + 333,33 + 333,34', () => {
    const rows = buildSchedule({
      balance: '1000',
      annualPct: '0',
      months: 3,
      firstDueDate: '2025-01-05',
    });
    expect(rows.map((row) => row.capital)).toEqual(['333.33', '333.33', '333.34']);
    expect(rows.every((row) => row.interest === '0')).toBe(true);
  });

  it('plans one installment for a term of one month', () => {
    const [row, ...rest] = buildSchedule({
      balance: '500',
      annualPct: '12',
      months: 1,
      firstDueDate: '2025-01-05',
    });
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ capital: '500', interest: '5', balanceAfter: '0' });
  });

  it('starts at a given number, as when rebuilding the rest of a loan', () => {
    const rows = buildSchedule({
      balance: '86088.28',
      annualPct: '3',
      months: 407,
      firstDueDate: '2026-10-05',
      firstNumber: 74,
    });
    expect(rows[0]?.number).toBe(74);
    expect(rows.at(-1)?.number).toBe(480);
    expect(sum(rows.map((row) => row.capital)).toString()).toBe('86088.28');
  });

  it('the reference loan: 111 600 € over 480 months, first installment 09/2020, last 08/2060', () => {
    const rows = buildSchedule({
      balance: '111600',
      annualPct: '1.5',
      months: 480,
      firstDueDate: '2020-09-05',
    });
    expect(rows).toHaveLength(480);
    expect(rows[0]?.dueDate).toBe('2020-09-05');
    expect(rows.at(-1)?.dueDate).toBe('2060-08-05');
    expect(sum(rows.map((row) => row.capital)).toString()).toBe('111600');
  });

  it('keeps the payment day when the month is shorter (clamped, never drifting)', () => {
    const rows = buildSchedule({
      balance: '100',
      annualPct: '0',
      months: 3,
      firstDueDate: '2025-01-31',
    });
    expect(rows.map((row) => row.dueDate)).toEqual(['2025-01-31', '2025-02-28', '2025-03-31']);
  });
});

describe('balances and years', () => {
  it('outstanding = principal − capital paid − prepayments (the reference loan)', () => {
    // 25 511,72 € of capital paid, of which 15 000 € was a prepayment: 111 600 − 25 511,72.
    expect(outstandingBalance('111600', '10511.72', '15000')).toBe('86088.28');
  });

  it('counts the installments left', () => {
    expect(remainingInstallments(480, 73)).toBe(407);
    expect(remainingInstallments(12, 20)).toBe(0);
  });

  it.each([
    [1, 1],
    [12, 1],
    [13, 2],
    [72, 6],
    [73, 7],
    [480, 40],
  ])('installment %i belongs to contract year %i', (number, year) => {
    expect(contractYear(number)).toBe(year);
  });
});

describe('configurable fields change every total consistently', () => {
  const rows: InstallmentAmounts[] = [
    {
      number: 1,
      dueDate: '2020-09-05',
      capital: '100',
      interest: '50',
      amounts: { lifeInsurance: '10', homeInsurance: '5', creditInsurance: '3', parking: '2' },
    },
    {
      number: 2,
      dueDate: '2020-10-05',
      capital: '101',
      interest: '49',
      amounts: { lifeInsurance: '10', homeInsurance: '5', creditInsurance: '3', parking: '2' },
    },
    {
      number: 13,
      dueDate: '2021-09-05',
      capital: '110',
      interest: '40',
      amounts: { lifeInsurance: '11', homeInsurance: '6' },
    },
  ];
  const defaults = DEFAULT_ENABLED_LOAN_FIELDS.map((key) => on(key));

  it('defaults are life and home insurance, nothing else', () => {
    expect([...DEFAULT_ENABLED_LOAN_FIELDS]).toEqual(['lifeInsurance', 'homeInsurance']);
  });

  it('counts only enabled fields in a row total', () => {
    expect(installmentTotal(rows[0] as InstallmentAmounts, defaults)).toBe('165');
    expect(installmentTotal(rows[0] as InstallmentAmounts, [...defaults, on('parking')])).toBe(
      '167',
    );
    expect(installmentTotal(rows[0] as InstallmentAmounts, [off('lifeInsurance')])).toBe('150');
  });

  it('the total, the period summary, the years and the cost of credit move together', () => {
    const base = [...defaults];
    const withParking = [...defaults, on('parking')];
    const before = totalsOf(rows, base);
    const after = totalsOf(rows, withParking);
    // Parking adds 2 + 2 € to the total and to the cost of credit, and nothing to capital or interest.
    expect(dec(after.total).minus(before.total).toString()).toBe('4');
    expect(dec(after.costOfCredit).minus(before.costOfCredit).toString()).toBe('4');
    expect(after.capital).toBe(before.capital);
    expect(after.interest).toBe(before.interest);

    const years = totalsByContractYear(rows, withParking);
    expect(sum(years.map((year) => year.total)).toString()).toBe(after.total);
    expect(sum(years.map((year) => year.costOfCredit)).toString()).toBe(after.costOfCredit);
    expect(years.map((year) => year.year)).toEqual([1, 2]);

    const period = periodTotals(rows, withParking, '2020-09-01', '2021-08-31');
    expect(period.count).toBe(2);
    expect(
      dec(period.total)
        .plus(years[1]?.total ?? 0)
        .toString(),
    ).toBe(after.total);
  });

  it('keeps the values of a disabled field and counts them again once it is enabled', () => {
    const hidden = totalsOf(rows, [...defaults, off('creditInsurance')]);
    const shown = totalsOf(rows, [...defaults, on('creditInsurance')]);
    expect(hidden.fields).not.toHaveProperty('creditInsurance');
    expect(shown.fields['creditInsurance']).toBe('6');
    expect(dec(shown.total).minus(hidden.total).toString()).toBe('6');
  });

  it('year 6 style: leaving credit insurance out lowers the year by exactly that amount', () => {
    const withIt = totalsByContractYear(rows, [...defaults, on('creditInsurance')]);
    const without = totalsByContractYear(rows, defaults);
    expect(
      dec(withIt[0]?.total ?? 0)
        .minus(without[0]?.total ?? 0)
        .toString(),
    ).toBe('6');
    expect(withIt[1]?.total).toBe(without[1]?.total);
  });
});

describe('expenseSplit', () => {
  const row: InstallmentAmounts = {
    number: 1,
    dueDate: '2020-09-05',
    capital: '300',
    interest: '60',
    amounts: { lifeInsurance: '10', homeInsurance: '5', stampTax: '2', refund: '7' },
  };

  it('interest, fees, taxes and insurances are expenses; the capital is savings', () => {
    expect(expenseSplit(row, [on('lifeInsurance'), on('homeInsurance'), on('stampTax')])).toEqual({
      expense: '77',
      savings: '300',
      other: '0',
    });
  });

  it('a custom field that is not an expense is kept apart; a disabled one is ignored', () => {
    expect(
      expenseSplit(row, [on('lifeInsurance'), on('refund', false), off('homeInsurance')]),
    ).toEqual({
      expense: '70',
      savings: '300',
      other: '7',
    });
  });
});

describe('mergeSchedule', () => {
  it('an actual installment replaces the projected one of the same number', () => {
    const projected = buildSchedule({
      balance: '1000',
      annualPct: '0',
      months: 4,
      firstDueDate: '2025-01-05',
    });
    const merged = mergeSchedule(
      [
        {
          number: 1,
          dueDate: '2025-01-07',
          capital: '260',
          interest: '1.5',
          balanceAfter: '740',
        },
      ],
      projected,
    );
    expect(merged.map((row) => [row.number, row.source])).toEqual([
      [1, 'actual'],
      [2, 'projected'],
      [3, 'projected'],
      [4, 'projected'],
    ]);
    expect(merged[0]).toMatchObject({ dueDate: '2025-01-07', capital: '260', payment: '261.5' });
  });

  it('is only the projection without actual installments', () => {
    const projected = buildSchedule({
      balance: '100',
      annualPct: '0',
      months: 2,
      firstDueDate: '2025-01-05',
    });
    expect(mergeSchedule([], projected).every((row) => row.source === 'projected')).toBe(true);
  });
});
