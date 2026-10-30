import { describe, expect, it } from 'vitest';

import type { GoalView } from '../../apps/web/src/lib/goals-view';
import {
  accountKey,
  emptyGoalForm,
  fieldsOf,
  goalChart,
  goalFormBody,
  goalToForm,
  isGoalFormComplete,
  monthAfter,
  statusKey,
  trimDecimal,
  valueTarget,
} from '../../apps/web/src/lib/goals-view';

const A = '0192f3a1-0000-7000-8000-00000000000a';
const S = '0192f3a1-0000-7000-8000-00000000000b';

const goal = (
  patch: Partial<GoalView> = {},
  result: Partial<GoalView['result']> = {},
): GoalView => ({
  id: '0192f3a1-0000-7000-8000-000000000001',
  name: 'Independência',
  color: '#9D6BFF',
  type: 'value',
  target: '300000.0000',
  mode: 'date',
  deadline: '2046-01-01',
  monthly: '450.0000',
  rate: '6.000000',
  yield: null,
  includeSavings: false,
  portfolioIds: [],
  accounts: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...patch,
  result: {
    mode: 'date',
    current: '51680',
    target: '300000',
    projected: '369793',
    required: '296.08',
    reachIn: null,
    etaMonth: null,
    months: 232,
    progress: '17.2',
    done: false,
    onTrack: true,
    status: 'on_track',
    yieldPct: '0',
    monthly: '450',
    path: [
      { month: 0, planned: '51680', required: '51680' },
      { month: 12, planned: '60000', required: '70000' },
      { month: 24, planned: '70000', required: '90000' },
    ],
    scopeNames: [],
    includesSavings: false,
    ...result,
  },
});

describe('statusKey', () => {
  it('turns the domain status into the message key', () => {
    expect(statusKey('on_track')).toBe('onTrack');
    expect(statusKey('no_contribution')).toBe('noContribution');
    expect(statusKey('reached')).toBe('reached');
  });
});

describe('monthAfter', () => {
  it('adds months across a year end', () => {
    expect(monthAfter('2026-11-15', 3)).toBe('2027-02');
    expect(monthAfter('2026-01-31', 0)).toBe('2026-01');
    expect(monthAfter('2026-12-01', 12)).toBe('2027-12');
  });
});

describe('goalChart', () => {
  it('labels the projection from today and draws the target as a flat line', () => {
    const chart = goalChart(goal(), '2026-10-28');
    expect(chart?.labels).toHaveLength(3);
    expect(chart?.planned).toEqual([51680, 60000, 70000]);
    expect(chart?.target).toEqual([300000, 300000, 300000]);
  });

  it('labels a short projection with month and year and a long one with the year', () => {
    const short = goalChart(goal(), '2026-10-28');
    expect(short?.labels).toEqual(['Out 2026', 'Out 2027', 'Out 2028']);
    const long = goal(
      {},
      {
        path: [
          { month: 0, planned: '1', required: null },
          { month: 120, planned: '2', required: null },
        ],
      },
    );
    expect(goalChart(long, '2026-10-28')?.labels).toEqual(['2026', '2036']);
  });

  it('turns an income target into the capital it needs', () => {
    const income = goal({ type: 'income', target: '1200.0000' }, { target: '1200', yieldPct: '4' });
    expect(valueTarget(income)).toBe(30000);
    expect(goalChart(income, '2026-10-28')?.target[0]).toBe(30000);
  });

  it('has no chart for a contrib goal, a tracked goal or a path of one point', () => {
    expect(goalChart(goal({ type: 'contrib' }), '2026-10-28')).toBeNull();
    expect(goalChart(goal({}, { mode: 'none' }), '2026-10-28')).toBeNull();
    expect(
      goalChart(goal({}, { path: [{ month: 0, planned: '1', required: null }] }), '2026-10-28'),
    ).toBeNull();
  });
});

describe('the goal form', () => {
  const base = emptyGoalForm({ deadline: '2036-10-28' });

  it('needs a name and a target above zero', () => {
    expect(isGoalFormComplete(base)).toBe(false);
    expect(isGoalFormComplete({ ...base, name: 'x', target: '0' })).toBe(false);
    expect(isGoalFormComplete({ ...base, name: ' ', target: '10' })).toBe(false);
    expect(isGoalFormComplete({ ...base, name: 'x', target: '1 000,5' })).toBe(true);
  });

  it('writes decimals with a dot, empty fields as null and the keys of the scopes as objects', () => {
    const body = goalFormBody({
      ...base,
      name: ' Reforma ',
      target: '1 000,5',
      monthly: '',
      rate: '5,5',
      portfolioIds: [A],
      accounts: [accountKey(A), accountKey(A, S)],
    });
    expect(body).toMatchObject({
      name: 'Reforma',
      target: '1000.5',
      monthly: null,
      rate: '5.5',
      yield: null,
      deadline: '2036-10-28',
      portfolioIds: [A],
      accounts: [
        { accountId: A, subAccountId: null },
        { accountId: A, subAccountId: S },
      ],
    });
  });

  it('forces a date for contrib and drops the deadline of the other modes', () => {
    expect(goalFormBody({ ...base, type: 'contrib', mode: 'none' })).toMatchObject({
      mode: 'date',
      deadline: '2036-10-28',
    });
    expect(goalFormBody({ ...base, mode: 'eta' })).toMatchObject({ mode: 'eta', deadline: null });
  });

  it('round-trips an existing goal without the padding zeros', () => {
    const form = goalToForm(
      goal({ accounts: [{ accountId: A, subAccountId: S }], portfolioIds: [A] }),
      '2036-10-28',
    );
    expect(form).toMatchObject({
      target: '300000',
      monthly: '450',
      rate: '6',
      yield: '',
      deadline: '2046-01-01',
      accounts: [`${A}|${S}`],
      portfolioIds: [A],
    });
    expect(trimDecimal('600.5000')).toBe('600.5');
    expect(trimDecimal('0.100000')).toBe('0.1');
    expect(trimDecimal('100')).toBe('100');
    expect(trimDecimal(null)).toBe('');
  });

  it('shows the fields of each type like the prototype', () => {
    expect(fieldsOf('value', 'date')).toMatchObject({ monthly: true, rate: true, yield: false });
    expect(fieldsOf('value', 'none')).toMatchObject({ monthly: false, rate: false });
    expect(fieldsOf('invested', 'date')).toMatchObject({
      monthly: true,
      rate: false,
      savings: true,
    });
    expect(fieldsOf('income', 'eta')).toMatchObject({ yield: true, savings: false });
    expect(fieldsOf('contrib', 'none')).toMatchObject({
      mode: false,
      deadline: true,
      monthly: false,
    });
  });
});
