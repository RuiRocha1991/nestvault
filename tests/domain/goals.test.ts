import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FX_RATES,
  goalCalc,
  goalKeys,
  goalScope,
  type Goal,
  type GoalAccount,
  type GoalData,
} from '@nestvault/domain';

import { makeOp } from '../support/investments';

const asOf = '2026-01-15';

/**
 * Reference portfolio p1: 100 units of ETF at 100 € (value 10 000), bought for 80 € (net invested
 * 8 000), paying 3 € per unit a year (income 300, yield 3 %).
 */
const etf = { id: 'etf', currency: 'EUR', price: '100', dps: '3', divMonths: [6] };
const noDividend = { ...etf, dps: null };

function data(partial: Partial<GoalData> = {}): GoalData {
  return {
    ops: [
      makeOp({
        type: 'buy',
        assetId: 'etf',
        date: '2024-03-01',
        portfolioId: 'p1',
        accountId: 'brk',
        subAccountId: 's1',
        qty: '50',
        price: '80',
      }),
      makeOp({
        type: 'buy',
        assetId: 'etf',
        date: '2026-01-05',
        portfolioId: 'p1',
        accountId: 'brk',
        subAccountId: 's1',
        qty: '50',
        price: '80',
      }),
    ],
    assets: [etf],
    accounts: [],
    moves: [],
    rates: DEFAULT_FX_RATES,
    portfolios: [
      { id: 'p1', name: 'Main' },
      { id: 'p2', name: 'Other' },
    ],
    plans: [],
    ...partial,
  };
}

const num = (value: { toNumber(): number } | null) => (value ? value.toNumber() : null);

describe('goalCalc — value goal, date mode', () => {
  it('zero rate is linear: projection, required contribution and path', () => {
    const goal: Goal = {
      type: 'value',
      target: '20000',
      rate: '0',
      monthly: '500',
      deadline: '2026-11-30',
    };
    const result = goalCalc(goal, data(), asOf);
    expect(result.mode).toBe('date');
    expect(num(result.current)).toBe(10000);
    expect(result.months).toBe(10);
    expect(num(result.projected)).toBe(15000);
    expect(num(result.required)).toBe(1000);
    expect(result.status).toBe('behind');
    expect(result.onTrack).toBe(false);
    expect(num(result.progress)).toBe(0.5);
    expect(result.path).toHaveLength(11);
    result.path.forEach((point) => {
      expect(num(point.planned)).toBe(10000 + 500 * point.month);
      expect(num(point.required)).toBe(10000 + 1000 * point.month);
    });
    // 10 000 now, 500 a month: 20 000 is reached after 20 months.
    expect(result.reachIn).toBe(20);
    expect(result.etaMonth).toBe('2027-09');
  });

  it('compounds at the monthly rate i = (1+r)^(1/12) - 1', () => {
    const goal: Goal = {
      type: 'value',
      target: '20000',
      rate: '12',
      monthly: '500',
      deadline: '2027-01-20',
    };
    const result = goalCalc(goal, data(), asOf);
    const i = Math.pow(1.12, 1 / 12) - 1;
    expect(result.months).toBe(12);
    // After exactly 12 months pv*1.12 + 500*(1.12-1)/i.
    expect(num(result.projected)).toBeCloseTo(10000 * 1.12 + (500 * 0.12) / i, 6);
    // required = (target - pv*1.12) * i / (1.12 - 1)
    expect(num(result.required)).toBeCloseTo(((20000 - 11200) * i) / 0.12, 6);
    // Paying exactly the required amount lands on the target.
    expect(num(result.path[result.path.length - 1]?.required ?? null)).toBeCloseTo(20000, 6);
  });

  it('is on track at 99.9 % of the target and not below', () => {
    // 10 000 + 10 x 99.9 = 10 999 against 11 000 (99.99 %): on track.
    const onTrack = goalCalc(
      { type: 'value', target: '11000', rate: '0', monthly: '99.9', deadline: '2026-11-01' },
      data(),
      asOf,
    );
    expect(num(onTrack.projected)).toBeCloseTo(10999, 9);
    expect(onTrack.status).toBe('on_track');
    // 10 000 + 10 x 98 = 10 980 against 11 000 (99.82 %): behind.
    const behind = goalCalc(
      { type: 'value', target: '11000', rate: '0', monthly: '98', deadline: '2026-11-01' },
      data(),
      asOf,
    );
    expect(behind.status).toBe('behind');
  });

  it('is reached when the current value already covers the target', () => {
    const result = goalCalc(
      { type: 'value', target: '9000', deadline: '2026-11-01' },
      data(),
      asOf,
    );
    expect(result.done).toBe(true);
    expect(result.status).toBe('reached');
    expect(result.onTrack).toBe(true);
    expect(num(result.progress)).toBe(1);
    expect(num(result.required)).toBe(0);
  });

  it('a deadline in the past needs the whole gap at once', () => {
    const result = goalCalc(
      { type: 'value', target: '12000', rate: '5', deadline: '2025-06-01' },
      data(),
      asOf,
    );
    expect(result.months).toBe(0);
    expect(num(result.required)).toBe(2000);
    expect(result.path).toHaveLength(1);
  });

  it('samples at most about 24 steps and always ends on the last month', () => {
    const base: Goal = { type: 'value', target: '50000', rate: '0', monthly: '10' };
    const thirty = goalCalc({ ...base, deadline: '2028-07-01' }, data(), asOf);
    expect(thirty.months).toBe(30);
    expect(thirty.path.map((p) => p.month)).toEqual([
      0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30,
    ]);
    const fifty = goalCalc({ ...base, deadline: '2030-03-01' }, data(), asOf);
    expect(fifty.months).toBe(50);
    expect(fifty.path.map((p) => p.month).slice(-3)).toEqual([45, 48, 50]);
  });

  it('refuses to run without a deadline', () => {
    expect(() => goalCalc({ type: 'value', target: '1' }, data(), asOf)).toThrow(RangeError);
  });
});

describe('goalCalc — eta and none modes', () => {
  it('eta: months until the planned contribution reaches the target', () => {
    const result = goalCalc(
      { type: 'value', target: '12000', rate: '0', monthly: '500', when: 'eta' },
      data(),
      asOf,
    );
    expect(result.reachIn).toBe(4);
    expect(result.etaMonth).toBe('2026-05');
    expect(result.months).toBe(4);
    expect(num(result.projected)).toBe(12000);
    expect(result.required).toBeNull();
    expect(result.status).toBe('eta');
    expect(result.onTrack).toBe(true);
    expect(result.path.every((p) => p.required === null)).toBe(true);
  });

  it('eta without contribution never gets there and falls back to 120 months', () => {
    const result = goalCalc(
      { type: 'value', target: '12000', rate: '0', monthly: '0', when: 'eta' },
      data(),
      asOf,
    );
    expect(result.reachIn).toBeNull();
    expect(result.etaMonth).toBeNull();
    expect(result.months).toBe(120);
    expect(result.status).toBe('no_contribution');
    expect(result.onTrack).toBe(false);
  });

  it('eta with growth only reaches the target through the rate', () => {
    // 10 000 at 12 % a year: 10 000 x 1.12^(m/12) >= 11 200 first at m = 12.
    const result = goalCalc(
      { type: 'value', target: '11200', rate: '12', when: 'eta' },
      data(),
      asOf,
    );
    expect(result.reachIn).toBe(12);
    expect(result.etaMonth).toBe('2027-01');
  });

  it('a reached eta goal shows as reached; a target within a month still plots one month', () => {
    const result = goalCalc({ type: 'value', target: '5000', when: 'eta' }, data(), asOf);
    expect(result.status).toBe('reached');
    expect(result.reachIn).toBe(0);
    expect(result.months).toBe(1);
  });

  it('none: only tracks progress', () => {
    const result = goalCalc(
      { type: 'value', target: '20000', monthly: '500', when: 'none' },
      data(),
      asOf,
    );
    expect(result.status).toBe('tracking');
    expect(result.projected).toBeNull();
    expect(result.required).toBeNull();
    expect(result.path).toEqual([]);
    expect(result.months).toBe(0);
    expect(result.onTrack).toBe(true);
    expect(num(result.progress)).toBe(0.5);
  });

  it('a zero target has no progress', () => {
    const result = goalCalc({ type: 'value', target: '0', when: 'none' }, data(), asOf);
    expect(num(result.progress)).toBe(0);
    expect(result.status).toBe('reached');
  });
});

describe('goalCalc — invested goal', () => {
  it('counts net invested and never grows with the rate', () => {
    const result = goalCalc(
      { type: 'invested', target: '9000', rate: '10', monthly: '250', when: 'eta' },
      data(),
      asOf,
    );
    expect(num(result.current)).toBe(8000);
    expect(result.reachIn).toBe(4);
    expect(num(result.projected)).toBe(9000);
  });

  it('date mode uses the linear required contribution', () => {
    const result = goalCalc(
      { type: 'invested', target: '9000', rate: '10', deadline: '2026-05-01' },
      data(),
      asOf,
    );
    expect(result.months).toBe(4);
    expect(num(result.required)).toBe(250);
  });
});

describe('goalCalc — income goal', () => {
  it('converts the income target to a value target with the goal yield', () => {
    // 600 / 4 % = 15 000 of investments; 10 000 now + 1 000 a month -> 5 months.
    const result = goalCalc(
      { type: 'income', target: '600', yield: '4', rate: '0', monthly: '1000', when: 'eta' },
      data(),
      asOf,
    );
    expect(num(result.current)).toBe(300);
    expect(num(result.yld)).toBe(0.04);
    expect(result.reachIn).toBe(5);
    // Income after 5 months is the projected value times the yield.
    expect(num(result.projected)).toBe(600);
  });

  it('falls back to the portfolio yield, then to 3 %', () => {
    const portfolioYield = goalCalc(
      { type: 'income', target: '600', rate: '0', monthly: '1000', when: 'eta' },
      data(),
      asOf,
    );
    expect(num(portfolioYield.yld)).toBe(0.03);
    // portfolio yield is 300 / 10 000 = 3 % -> value target 20 000 -> 10 months.
    expect(portfolioYield.reachIn).toBe(10);

    const withoutIncome = goalCalc(
      { type: 'income', target: '600', rate: '0', monthly: '1000', when: 'eta' },
      data({ assets: [noDividend] }),
      asOf,
    );
    expect(num(withoutIncome.yld)).toBe(0.03);
    expect(num(withoutIncome.current)).toBe(0);

    const richer = goalCalc(
      { type: 'income', target: '600', rate: '0', when: 'eta', monthly: '1000' },
      data({ assets: [{ ...etf, dps: '5' }] }),
      asOf,
    );
    expect(num(richer.yld)).toBe(0.05);
    expect(richer.reachIn).toBe(2);
  });

  it('date mode reports the monthly contribution in value terms', () => {
    const result = goalCalc(
      { type: 'income', target: '600', yield: '3', rate: '0', deadline: '2026-11-01' },
      data(),
      asOf,
    );
    // value target 20 000, gap 10 000 over 10 months.
    expect(num(result.required)).toBe(1000);
    expect(num(result.projected)).toBe(300);
  });
});

describe('goalCalc — contrib goal', () => {
  const plans = [
    { active: true, amount: '500', portfolioId: 'p1' },
    { active: false, amount: '300', portfolioId: 'p1' },
    { active: true, amount: '700', portfolioId: 'p2' },
  ];

  it('current = buys in the deadline year; projected adds active plans for the months left', () => {
    const goal: Goal = {
      type: 'contrib',
      target: '10000',
      deadline: '2026-12-31',
      portfolioIds: ['p1'],
    };
    const result = goalCalc(goal, data({ plans }), '2026-06-10');
    // Only the 2026 buy counts: 50 x 80.
    expect(num(result.current)).toBe(4000);
    expect(result.mode).toBe('date');
    expect(result.months).toBe(6);
    expect(num(result.projected)).toBe(4000 + 500 * 6);
    expect(num(result.required)).toBe(1000);
    expect(result.status).toBe('behind');
    expect(result.path).toEqual([]);
  });

  it('without a portfolio filter every active plan counts', () => {
    const result = goalCalc(
      { type: 'contrib', target: '10000', deadline: '2026-12-31' },
      data({ plans }),
      '2026-06-10',
    );
    expect(num(result.projected)).toBe(4000 + 1200 * 6);
    expect(result.status).toBe('on_track');
  });

  it('the fee is part of what was invested and a deadline month already passed needs it all', () => {
    const feeData = data({
      ops: [
        makeOp({
          type: 'buy',
          assetId: 'etf',
          date: '2026-02-01',
          portfolioId: 'p1',
          qty: '10',
          price: '100',
          fee: '5',
        }),
      ],
    });
    const result = goalCalc(
      { type: 'contrib', target: '2000', deadline: '2026-06-30' },
      feeData,
      '2026-12-10',
    );
    expect(num(result.current)).toBe(1005);
    expect(result.months).toBe(0);
    expect(num(result.required)).toBe(995);
  });
});

describe('goalScope', () => {
  const accounts: GoalAccount[] = [
    {
      id: 'brk',
      name: 'Broker',
      currency: 'EUR',
      trackCash: false,
      isBrokerage: true,
      balance: '0',
      interest: '0',
      kind: 'other',
      subAccounts: [{ id: 's1', name: 'Rui' }],
    },
    {
      id: 'sav',
      name: 'Savings',
      currency: 'EUR',
      trackCash: true,
      isBrokerage: false,
      balance: '1000',
      interest: '100',
      kind: 'savings',
    },
    {
      id: 'td',
      name: 'Term deposit',
      currency: 'EUR',
      trackCash: true,
      isBrokerage: false,
      balance: '2100',
      interest: '100',
      kind: 'term',
      capital: '2000',
    },
    {
      id: 'chk',
      name: 'Checking',
      currency: 'EUR',
      trackCash: true,
      isBrokerage: false,
      balance: '500',
      interest: '0',
      kind: 'other',
    },
  ];

  it('portfolio scope: investments only, all portfolios by default', () => {
    const scope = goalScope({ type: 'value', target: '1' }, data({ accounts }), asOf);
    expect(num(scope.value)).toBe(10000);
    expect(num(scope.invested)).toBe(8000);
    expect(num(scope.income)).toBe(300);
    expect(scope.names).toEqual([]);
    expect(scope.ops).toHaveLength(2);
  });

  it('portfolio scope can add savings and term deposits not held by the portfolio', () => {
    const scope = goalScope(
      { type: 'value', target: '1', portfolioIds: ['p1'], includeSavings: true },
      data({ accounts }),
      asOf,
    );
    expect(num(scope.value)).toBe(10000 + 1000 + 2100);
    // Savings count without their interest, a term deposit at its principal.
    expect(num(scope.invested)).toBe(8000 + 900 + 2000);
    expect(scope.names).toEqual(['Main']);
    expect(scope.includesSavings).toBe(true);
  });

  it('a savings account linked to a scoped portfolio is not added twice', () => {
    const linked = accounts.map((a) => (a.id === 'sav' ? { ...a, portfolioId: 'p1' } : a));
    const scope = goalScope(
      { type: 'value', target: '1', portfolioIds: ['p1'], includeSavings: true },
      data({ accounts: linked }),
      asOf,
    );
    // The linked savings account is already in the portfolio summary (cash 1 000, interest 100
    // counted as profit); only the term deposit is added on top.
    expect(num(scope.value)).toBe(10000 + 1000 + 2100);
    expect(num(scope.invested)).toBe(8000 + 900 + 2000);
  });

  it('account scope: each kind of account contributes its own value and invested amount', () => {
    const at = (keys: string[]) =>
      goalScope({ type: 'value', target: '1', accounts: keys }, data({ accounts }), asOf);
    const brokerage = at(['brk']);
    expect([num(brokerage.value), num(brokerage.invested), num(brokerage.income)]).toEqual([
      10000, 8000, 300,
    ]);
    expect(brokerage.names).toEqual(['Broker']);
    const sub = at(['brk|s1']);
    expect([num(sub.value), num(sub.invested)]).toEqual([10000, 8000]);
    expect(sub.names).toEqual(['Broker · Rui']);
    const savings = at(['sav']);
    expect([num(savings.value), num(savings.invested)]).toEqual([1000, 900]);
    const term = at(['td']);
    expect([num(term.value), num(term.invested)]).toEqual([2100, 2000]);
    const paidBack = goalScope(
      { type: 'value', target: '1', accounts: ['td'] },
      data({ accounts: accounts.map((a) => (a.id === 'td' ? { ...a, returned: true } : a)) }),
      asOf,
    );
    expect(num(paidBack.invested)).toBe(0);
    const checking = at(['chk']);
    expect([num(checking.value), num(checking.invested)]).toEqual([500, 500]);
    const several = at(['brk', 'sav', 'chk']);
    expect([num(several.value), num(several.invested)]).toEqual([11500, 9400]);
    expect(several.yld.toNumber()).toBeCloseTo(0.03, 12);
  });

  it('converts a foreign-currency account to EUR', () => {
    const usd = { ...accounts[3], id: 'usd', currency: 'USD', balance: '100' } as GoalAccount;
    const scope = goalScope(
      { type: 'value', target: '1', accounts: ['usd'] },
      data({ accounts: [usd] }),
      asOf,
    );
    expect(num(scope.value)).toBe(92);
  });

  it('account scope filters the operations and plans', () => {
    const other = makeOp({
      type: 'buy',
      assetId: 'etf',
      date: '2026-02-01',
      accountId: 'other',
      qty: '1',
      price: '1',
    });
    const scope = goalScope(
      { type: 'value', target: '1', accounts: ['brk|s1'] },
      data({
        accounts,
        ops: [...data().ops, other],
        plans: [
          { active: true, amount: '10', accountId: 'brk', subAccountId: 's1' },
          { active: true, amount: '20', accountId: 'brk', subAccountId: 's2' },
          { active: true, amount: '30', accountId: 'sav' },
        ],
      }),
      asOf,
    );
    expect(scope.ops).toHaveLength(2);
    expect(scope.plans.map((p) => p.amount)).toEqual(['10']);
  });
});

describe('goalKeys', () => {
  const accounts = [
    { id: 'a', subAccounts: [{ id: 's', name: 'S' }] },
    { id: 'b' },
  ] as unknown as GoalAccount[];

  it('keeps existing accounts and sub-accounts only', () => {
    expect(goalKeys({ accounts: ['a', 'b|s', 'zzz', 'a|zzz', 'b'] }, accounts)).toEqual(['a', 'b']);
  });

  it('drops a sub-account when its whole account is chosen', () => {
    expect(goalKeys({ accounts: ['a|s', 'a'] }, accounts)).toEqual(['a']);
    expect(goalKeys({ accounts: ['a|s'] }, accounts)).toEqual(['a|s']);
  });

  it('treats a hostile key as data', () => {
    expect(goalKeys({ accounts: ["' OR 1=1 --", '|'] }, accounts)).toEqual([]);
    expect(goalKeys({}, accounts)).toEqual([]);
  });
});

describe('goalCalc — input hardening', () => {
  it('rejects a rate of -100 % or lower', () => {
    expect(() =>
      goalCalc({ type: 'value', target: '1', rate: '-100', when: 'eta' }, data(), asOf),
    ).toThrow(RangeError);
  });

  it('a negative yield falls back like a missing one', () => {
    const result = goalCalc(
      { type: 'income', target: '600', yield: '-3', when: 'none' },
      data(),
      asOf,
    );
    expect(num(result.yld)).toBe(0.03);
  });

  it('counts a repeated account once and drops unknown portfolios from the names', () => {
    const accounts = [{ id: 'a', name: 'A' }] as unknown as GoalAccount[];
    expect(goalKeys({ accounts: ['a', 'a'] }, accounts)).toEqual(['a']);
    const scope = goalScope(
      { type: 'value', target: '1', portfolioIds: ['p1', 'gone'] },
      data(),
      asOf,
    );
    expect(scope.names).toEqual(['Main']);
  });
});
