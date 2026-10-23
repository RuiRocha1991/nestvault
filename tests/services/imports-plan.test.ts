import { describe, expect, it } from 'vitest';

import { transactionHash } from '@nestvault/domain';

import {
  planOperations,
  planTransactions,
  type ParsedRow,
} from '../../packages/services/src/imports/plan';

const ACCOUNT = '0198f000-0000-7000-8000-0000000000a1';

const bank = (date: string, description: string, amount: string): ParsedRow => ({
  kind: 'bank',
  date,
  description,
  amount,
  balance: null,
  external_id: null,
});

const broker = (overrides: Partial<Extract<ParsedRow, { kind: 'broker' }>>): ParsedRow => ({
  kind: 'broker',
  date: '2026-09-05',
  type: 'dividend',
  symbol: 'AAA.US',
  quantity: null,
  price: null,
  amount: '1',
  currency: 'USD',
  holder: null,
  external_id: null,
  ...overrides,
});

describe('planTransactions', () => {
  it('hashes a line the way the domain does', () => {
    const [line] = planTransactions(ACCOUNT, [bank('2026-01-05', 'Café Central', '-1.2')]);
    expect(line?.hash).toBe(
      transactionHash(
        { accountId: ACCOUNT, date: '2026-01-05', description: 'Café Central', amount: '-1.2' },
        1,
      ),
    );
  });

  it('two identical lines of one file are two lines (occurrence index)', () => {
    const rows = [
      bank('2026-01-05', 'Café Central', '-1.20'),
      bank('2026-01-05', 'CAFE  central', '-1.2'),
      bank('2026-01-05', 'Café Central', '-1.20'),
    ];
    const hashes = planTransactions(ACCOUNT, rows).map((line) => line.hash);
    expect(new Set(hashes).size).toBe(3);
  });

  it('gives the same hashes when the same file is read again, and other hashes for another account', () => {
    const rows = [bank('2026-01-05', 'Café', '-1.2'), bank('2026-01-05', 'Café', '-1.2')];
    const first = planTransactions(ACCOUNT, rows).map((line) => line.hash);
    const again = planTransactions(ACCOUNT, rows).map((line) => line.hash);
    const other = planTransactions('0198f000-0000-7000-8000-0000000000a2', rows).map((l) => l.hash);
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it('writes amounts as plain decimals and flags lines the ledger cannot hold', () => {
    const lines = planTransactions(ACCOUNT, [
      bank('2026-01-05', 'A', '-45.00'),
      bank('2026-01-05', 'B', '0.12345'),
      bank('2026-01-05', 'C', '1234567890123456'),
      bank('2026-01-05', '   ', '1'),
    ]);
    expect(lines.map((line) => [line.amount, line.valid])).toEqual([
      ['-45', true],
      ['0.12345', false],
      ['1234567890123456', false],
      ['1', false],
    ]);
  });

  it('keeps the position of each line and ignores broker lines', () => {
    const lines = planTransactions(ACCOUNT, [broker({}), bank('2026-01-05', 'A', '1')]);
    expect(lines.map((line) => line.index)).toEqual([1]);
  });
});

describe('planOperations', () => {
  it('turns buys and sells into one operation each, rounded to the columns', () => {
    const { operations, unsupported } = planOperations([
      broker({
        type: 'buy',
        quantity: '50',
        price: '10.123456789',
        amount: '-506',
        external_id: 'xtb:1',
      }),
      broker({
        type: 'sell',
        quantity: '1.123456789',
        price: '12',
        amount: '12',
        external_id: 'xtb:2',
        holder: 'Rui',
      }),
    ]);
    expect(unsupported).toEqual([]);
    expect(operations.map((o) => [o.type, o.symbol, o.qty, o.price, o.extId, o.holder])).toEqual([
      ['buy', 'AAA.US', '50', '10.123457', 'xtb:1', null],
      ['sell', 'AAA.US', '1.12345679', '12', 'xtb:2', 'Rui'],
    ]);
  });

  it('merges the dividend, its tax and a refund of one symbol and day into one operation', () => {
    const { operations } = planOperations([
      broker({ type: 'dividend', amount: '20.00', external_id: 'xtb:11' }),
      broker({ type: 'tax', amount: '-3.00', external_id: 'xtb:10' }),
      broker({ type: 'dividend', symbol: 'BBB.US', amount: '5', external_id: 'xtb:20' }),
    ]);
    expect(operations).toHaveLength(2);
    const [alpha, beta] = operations;
    expect(alpha).toMatchObject({
      type: 'dividend',
      symbol: 'AAA.US',
      gross: '20',
      tax: '3',
      amount: '17',
      extId: 'xtb:10',
    });
    expect(beta).toMatchObject({ gross: '5', tax: null, amount: '5', extId: 'xtb:20' });
  });

  it('a refund alone is a dividend operation with negative tax and no gross', () => {
    const { operations } = planOperations([
      broker({ type: 'refund', amount: '4.24', date: '2026-09-28', external_id: 'xtb:30' }),
    ]);
    expect(operations).toEqual([
      expect.objectContaining({ type: 'dividend', gross: null, tax: '-4.24', amount: '4.24' }),
    ]);
  });

  it('lines of the same symbol on different days stay apart', () => {
    const { operations } = planOperations([
      broker({ date: '2026-09-05', amount: '1' }),
      broker({ date: '2026-09-06', amount: '1' }),
    ]);
    expect(operations.map((o) => o.date)).toEqual(['2026-09-05', '2026-09-06']);
  });

  it('does not store cash movements, fees or lines without what they need', () => {
    const { operations, unsupported } = planOperations([
      broker({ type: 'deposit', symbol: null, amount: '1000' }),
      broker({ type: 'withdrawal', symbol: null, amount: '-10' }),
      broker({ type: 'fee', symbol: null, amount: '-1' }),
      broker({ type: 'buy', quantity: null, price: null, amount: '-5' }),
      broker({ type: 'buy', quantity: '0', price: '1', amount: '-5' }),
      broker({ type: 'sell', quantity: '1', price: '-1', amount: '5' }),
      broker({ type: 'dividend', symbol: ' ', amount: '5' }),
      bank('2026-01-01', 'x', '1'),
    ]);
    expect(operations).toEqual([]);
    expect(unsupported).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('upper-cases and trims symbols so one asset is not split in two', () => {
    const { operations } = planOperations([
      broker({ type: 'buy', symbol: ' aaa.us ', quantity: '1', price: '1', amount: '-1' }),
      broker({ type: 'buy', symbol: 'AAA.US', quantity: '1', price: '1', amount: '-1' }),
    ]);
    expect(new Set(operations.map((o) => o.symbol))).toEqual(new Set(['AAA.US']));
  });

  it('keeps file order', () => {
    const { operations } = planOperations([
      broker({ type: 'dividend', symbol: 'ZZZ.US', date: '2026-09-09' }),
      broker({ type: 'buy', quantity: '1', price: '1', amount: '-1', date: '2026-09-01' }),
    ]);
    expect(operations.map((o) => o.type)).toEqual(['dividend', 'buy']);
  });
});
