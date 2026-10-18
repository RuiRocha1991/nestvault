import { describe, expect, it } from 'vitest';

import {
  depositFlowKey,
  depositFlows,
  depositMaturity,
  depositSchedule,
  depositValue,
  linkDepositFlows,
  roundCents,
  toPlain,
  type Deposit,
  type DepositFlow,
  type LinkableTransaction,
} from '@nestvault/domain';

import { must } from '../support/investments';

const TAX = '28';

/** 10 000 € at 2,5 % for 12 months, paid quarterly, 28 % tax, interest capitalizing. */
const quarterly: Deposit = {
  id: 'dep',
  capital: '10000',
  rate: '2.5',
  start: '2025-01-15',
  payN: 3,
  payU: 'm',
  termN: 12,
  termU: 'm',
};

const rows = (periods: ReturnType<typeof depositSchedule>) =>
  periods.map((p) => [p.date, p.days, toPlain(p.base), toPlain(p.gross), toPlain(p.net)]);

describe('depositSchedule', () => {
  it('equals the hand-computed table for 12 months at 2,5 % paid quarterly, 28 % tax, capitalizing', () => {
    expect(rows(depositSchedule(quarterly, '2025-06-01', TAX))).toEqual([
      ['2025-04-15', 90, '10000', '61.64', '44.38'],
      ['2025-07-15', 91, '10044.38', '62.61', '45.08'],
      ['2025-10-15', 92, '10089.46', '63.58', '45.78'],
      ['2026-01-15', 92, '10135.24', '63.87', '45.99'],
    ]);
  });

  it('keeps the base when a pay-to account receives the interest', () => {
    const paidOut = depositSchedule({ ...quarterly, payTo: 'chk' }, '2025-06-01', TAX);
    expect(paidOut.map((p) => toPlain(p.base))).toEqual(['10000', '10000', '10000', '10000']);
  });

  it('clamps month ends: a start on the 31st gives 28 Feb, 31 Mar, 30 Apr, 31 May', () => {
    const monthly: Deposit = { ...quarterly, start: '2025-01-31', payN: 1, termN: null };
    const dates = depositSchedule(monthly, '2025-01-31', TAX).map((p) => p.date);
    expect(dates.slice(0, 4)).toEqual(['2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31']);
    const leap = depositSchedule({ ...monthly, start: '2024-01-31' }, '2024-01-31', TAX);
    expect(must(leap[0]).date).toBe('2024-02-29');
  });

  it('is open-ended up to 24 months after asOf and supports day periods', () => {
    const open: Deposit = { ...quarterly, termN: null, payN: 6 };
    const dates = depositSchedule(open, '2025-01-15', TAX).map((p) => p.date);
    expect(dates).toHaveLength(4);
    expect(dates[3]).toBe('2027-01-15'); // the horizon (asOf + 24 months) is inclusive
    const daily = depositSchedule(
      { ...quarterly, payN: 30, payU: 'd', termN: 90, termU: 'd' },
      '2025-01-15',
      TAX,
    );
    expect(daily.map((p) => p.date)).toEqual(['2025-02-14', '2025-03-16', '2025-04-15']);
  });

  it('clamps the last period to the maturity', () => {
    const odd: Deposit = { ...quarterly, termN: 10, payN: 4 };
    expect(depositSchedule(odd, '2025-01-15', TAX).map((p) => p.date)).toEqual([
      '2025-05-15',
      '2025-09-15',
      '2025-11-15',
    ]);
  });

  it('uses the deposit tax over the default, and nothing for unscheduled or unstarted deposits', () => {
    const own = depositSchedule({ ...quarterly, tax: '0' }, '2025-01-15', TAX);
    expect(toPlain(must(own[0]).net)).toBe('61.64');
    expect(depositSchedule({ ...quarterly, payN: 0 }, '2025-01-15', TAX)).toEqual([]);
    expect(depositSchedule({ ...quarterly, start: null }, '2025-01-15', TAX)).toEqual([]);
  });
});

describe('depositMaturity', () => {
  it('uses termN with its unit, the older termMonths, or none', () => {
    expect(depositMaturity(quarterly)).toBe('2026-01-15');
    expect(depositMaturity({ ...quarterly, termN: 90, termU: 'd' })).toBe('2025-04-15');
    expect(depositMaturity({ ...quarterly, termN: null, termMonths: 6 })).toBe('2025-07-15');
    expect(depositMaturity({ ...quarterly, termN: null })).toBeNull();
    expect(depositMaturity({ ...quarterly, termN: 0 })).toBeNull();
    expect(depositMaturity({ ...quarterly, start: null })).toBeNull();
  });
});

describe('depositValue', () => {
  it('scheduled and capitalizing: capital plus interest to date, with the accrued part', () => {
    const value = depositValue(quarterly, '2025-10-20', TAX);
    expect(toPlain(value.paid)).toBe('135.24');
    expect(toPlain(value.net)).toBe('135.24');
    expect(toPlain(value.gross)).toBe('187.83');
    expect(toPlain(value.value)).toBe('10135.24');
    expect(value.accrued.toNumber()).toBeCloseTo(2.4991, 4);
    expect(must(value.next).date).toBe('2026-01-15');
    expect(value.matured).toBe(false);
  });

  it('with a pay-to account the value stays at the capital', () => {
    const value = depositValue({ ...quarterly, payTo: 'chk' }, '2025-10-20', TAX);
    expect(toPlain(value.value)).toBe('10000');
    expect(toPlain(value.net)).toBe('0');
    expect(toPlain(value.paid)).toBe('134.63');
  });

  it('at maturity: returned deposits are worth 0, others keep capital plus interest', () => {
    const kept = depositValue(quarterly, '2026-01-15', TAX);
    expect(kept.matured).toBe(true);
    expect(kept.returned).toBe(false);
    expect(toPlain(kept.value)).toBe('10181.23');
    expect(toPlain(kept.accrued)).toBe('0');
    const returned = depositValue({ ...quarterly, fundFrom: 'chk' }, '2026-01-15', TAX);
    expect(returned.returned).toBe(true);
    expect(toPlain(returned.value)).toBe('0');
    expect(toPlain(returned.net)).toBe('0');
  });

  it('unscheduled deposits earn simple or compound interest, capped at maturity', () => {
    const base: Deposit = {
      id: 'u',
      capital: '1000',
      rate: '3',
      start: '2025-01-01',
      tax: '28',
      termN: 12,
      termU: 'm',
    };
    const simple = depositValue(base, '2026-01-01', TAX);
    expect(toPlain(simple.gross)).toBe('30');
    expect(toPlain(simple.net)).toBe('21.6');
    expect(toPlain(simple.value)).toBe('1021.6');
    const compound = depositValue({ ...base, rate: '5', capitalize: true }, '2026-01-01', TAX);
    expect(toPlain(roundCents(compound.gross))).toBe('50');
    const later = depositValue(base, '2030-01-01', TAX);
    expect(toPlain(later.gross)).toBe('30'); // does not keep earning after maturity
  });

  it('is zero before the start or without a start date', () => {
    expect(toPlain(depositValue(quarterly, '2024-12-31', TAX).value)).toBe('0');
    expect(toPlain(depositValue({ ...quarterly, start: null }, '2025-06-01', TAX).value)).toBe('0');
  });
});

describe('depositFlows', () => {
  const dep: Deposit = { ...quarterly, fundFrom: 'chk', payTo: 'chk' };

  it('capital out, net interest in, capital back at maturity', () => {
    const flows = depositFlows('chk', [dep], '2025-06-01', TAX);
    expect(flows.map((f) => [f.kind, f.date, toPlain(f.amount)])).toEqual([
      ['capital', '2025-01-15', '-10000'],
      ['interest', '2025-04-15', '44.38'],
      ['interest', '2025-07-15', '44.88'],
      ['interest', '2025-10-15', '45.37'],
      ['interest', '2026-01-15', '45.37'],
      ['redemption', '2026-01-15', '10000'],
    ]);
  });

  it('adds the capitalized interest to the redemption when the interest stays in the deposit', () => {
    const flows = depositFlows('chk', [{ ...quarterly, fundFrom: 'chk' }], '2025-06-01', TAX);
    expect(flows.map((f) => f.kind)).toEqual(['capital', 'redemption']);
    expect(toPlain(must(flows[1]).amount)).toBe('10181.23');
  });

  it('only includes the account asked for and scheduled deposits', () => {
    expect(depositFlows('other', [dep], '2025-06-01', TAX)).toEqual([]);
    expect(depositFlows('chk', [{ ...dep, payN: 0 }], '2025-06-01', TAX)).toEqual([]);
  });

  it('returns the money to the pay-to account when there is no funding account', () => {
    const flows = depositFlows('sav', [{ ...quarterly, payTo: 'sav' }], '2025-06-01', TAX);
    expect(flows.at(-1)?.kind).toBe('redemption');
    expect(flows.some((f) => f.kind === 'capital')).toBe(false);
  });
});

describe('linkDepositFlows', () => {
  const flows = depositFlows(
    'chk',
    [{ ...quarterly, fundFrom: 'chk', payTo: 'chk' }],
    '2025-06-01',
    TAX,
  );
  const tx = (
    partial: Partial<LinkableTransaction> & Pick<LinkableTransaction, 'id'>,
  ): LinkableTransaction => ({
    accountId: 'chk',
    date: '2025-01-15',
    amount: '-10000',
    ...partial,
  });

  it('links capital within 0,011 and ±5 days as a transfer', () => {
    const decisions = linkDepositFlows(
      [tx({ id: 'a', date: '2025-01-17', amount: '-10000.005' })],
      flows,
    );
    expect(decisions).toEqual([
      {
        transactionId: 'a',
        depositId: 'dep',
        flowKey: 'dep:2025-01-15:capital',
        kind: 'capital',
        markAsTransfer: true,
        markAsDepositInterest: false,
      },
    ]);
  });

  it('links interest within max(0,05; 2 %) and marks it as the deposit interest, not a transfer', () => {
    const [decision] = linkDepositFlows(
      [tx({ id: 'i', date: '2025-04-17', amount: '44.0' })],
      flows,
    );
    expect(decision).toMatchObject({
      kind: 'interest',
      markAsTransfer: false,
      markAsDepositInterest: true,
    });
    expect(linkDepositFlows([tx({ id: 'i', date: '2025-04-17', amount: '43.0' })], flows)).toEqual(
      [],
    );
  });

  it('rejects wrong sign, amount off by more than 0,011, dates past 5 days and other accounts', () => {
    const bad = [
      tx({ id: 'sign', amount: '10000' }),
      tx({ id: 'amount', amount: '-10000.012' }),
      tx({ id: 'date', date: '2025-01-21' }),
      tx({ id: 'account', accountId: 'other' }),
    ];
    expect(linkDepositFlows(bad, flows)).toEqual([]);
  });

  it('records the link of a locked transaction without turning it into a transfer', () => {
    const [decision] = linkDepositFlows([tx({ id: 'l', transferLocked: true })], flows);
    expect(decision).toMatchObject({ markAsTransfer: false, markAsDepositInterest: false });
  });

  it('links a line to at most one flow and a flow to at most one line', () => {
    const decisions = linkDepositFlows([tx({ id: 'first' }), tx({ id: 'second' })], flows);
    expect(decisions.map((d) => d.transactionId)).toEqual(['first']);
  });

  it('is idempotent: applying the decisions and running again links nothing new', () => {
    const lines: LinkableTransaction[] = [
      tx({ id: 'cap' }),
      tx({ id: 'int1', date: '2025-04-15', amount: '44.38' }),
      tx({ id: 'int2', date: '2025-07-16', amount: '44.4' }),
    ];
    const first = linkDepositFlows(lines, flows);
    expect(first.map((d) => d.transactionId)).toEqual(['cap', 'int1', 'int2']);
    const applied = lines.map((line) => {
      const d = first.find((x) => x.transactionId === line.id);
      return d ? { ...line, depositLink: d.flowKey } : line;
    });
    expect(linkDepositFlows(applied, flows)).toEqual([]);
    // a flow whose key is already stored is skipped even if the line was deleted
    expect(
      linkDepositFlows(
        [tx({ id: 'new' }), { ...tx({ id: 'old' }), depositLink: 'dep:2025-01-15:capital' }],
        flows,
      ),
    ).toEqual([]);
  });

  it('builds a stable key', () => {
    const flow = must(flows[0]) satisfies DepositFlow;
    expect(depositFlowKey(flow)).toBe('dep:2025-01-15:capital');
  });
});
