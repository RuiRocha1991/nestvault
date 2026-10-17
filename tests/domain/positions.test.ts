import { describe, expect, it } from 'vitest';

import {
  add,
  cashEffect,
  cashEffectNative,
  computeHoldings,
  DEFAULT_FX_RATES,
  positionKey,
  priceAt,
  realizedGainsPerSale,
  roundCents,
  sub,
  sum,
  toPlain,
  type InvestmentAsset,
  type InvestmentOp,
} from '@nestvault/domain';

import { makeOp, must } from '../support/investments';

const TODAY = '2026-09-01';
const opts = { asOf: TODAY, today: TODAY };

const fund: InvestmentAsset = { id: 'fund', currency: 'EUR', price: '8.017' };
const aapl: InvestmentAsset = { id: 'aapl', currency: 'USD', price: '200', dps: '1' };
const sxr: InvestmentAsset = { id: 'sxr', currency: 'EUR', price: '100' };

const op = makeOp;

/** Two lots per holder; the fee on the second lot makes each holder's cost exact. */
const holders = [
  { sub: 'rui', qty: '1234.9144', lot1: '500', p2: '7.6881', fee: '0.05460136' },
  { sub: 'lili', qty: '596.7909', lot1: '300', p2: '8.2553', fee: '0.02208323' },
  { sub: 'simao', qty: '504.8609', lot1: '200', p2: '5.7411', fee: '0.02308701' },
  {
    sub: 'vicente',
    qty: '309.5371',
    lot1: '100',
    p2: '4.6107',
    fee: '0.01729303',
  },
];

const bancoInvestOps: InvestmentOp[] = holders.flatMap((h) => [
  op({
    type: 'buy',
    assetId: 'fund',
    date: '2025-01-10',
    accountId: 'bi',
    subAccountId: h.sub,
    qty: h.lot1,
    price: '7.5',
  }),
  op({
    type: 'buy',
    assetId: 'fund',
    date: '2025-06-10',
    accountId: 'bi',
    subAccountId: h.sub,
    qty: remainder(h.qty, h.lot1),
    price: h.p2,
    fee: h.fee,
  }),
]);

function remainder(total: string, lot1: string): string {
  return toPlain(sub(total, lot1));
}

describe('computeHoldings — Banco Invest sub-accounts', () => {
  const rows = computeHoldings(bancoInvestOps, [fund], DEFAULT_FX_RATES, {
    ...opts,
    groupBy: 'position',
  });

  it('keeps one position per holder with the reference units and value @ 8,017 €', () => {
    const expected: Record<string, [string, string]> = {
      rui: ['1234.9144', '9900.31'],
      lili: ['596.7909', '4784.47'],
      simao: ['504.8609', '4047.47'],
      vicente: ['309.5371', '2481.56'],
    };
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const [units, value] = expected[row.subAccountId ?? ''] ?? [];
      expect(toPlain(row.qty)).toBe(units);
      expect(toPlain(roundCents(row.value))).toBe(value);
    }
  });

  it('adds up to the reference market value and invested amount', () => {
    expect(toPlain(roundCents(sum(rows.map((r) => r.value))))).toBe('21213.81');
    expect(toPlain(roundCents(sum(rows.map((r) => r.cost))))).toBe('19066.66');
  });

  it('merges the sub-accounts when grouping by asset (default)', () => {
    const merged = computeHoldings(bancoInvestOps, [fund], DEFAULT_FX_RATES, opts);
    expect(merged).toHaveLength(1);
    expect(toPlain(must(merged[0]).qty)).toBe('2646.1033');
  });

  it('filters one holder with accountId + subAccountId, and the whole account without it', () => {
    const rui = computeHoldings(bancoInvestOps, [fund], DEFAULT_FX_RATES, {
      ...opts,
      accountId: 'bi',
      subAccountId: 'rui',
    });
    expect(toPlain(must(rui[0]).qty)).toBe('1234.9144');
    const account = computeHoldings(bancoInvestOps, [fund], DEFAULT_FX_RATES, {
      ...opts,
      accountId: 'bi',
    });
    expect(toPlain(must(account[0]).qty)).toBe('2646.1033');
    expect(
      computeHoldings(bancoInvestOps, [fund], DEFAULT_FX_RATES, { ...opts, accountId: null }),
    ).toEqual([]);
  });
});

describe('computeHoldings — mixed USD/EUR fixture (prototype values)', () => {
  const ops = [
    op({ type: 'buy', assetId: 'aapl', date: '2025-01-10', qty: '10', price: '150', fee: '5' }),
    op({ type: 'buy', assetId: 'aapl', date: '2025-03-01', qty: '5', price: '180' }),
    op({ type: 'sell', assetId: 'aapl', date: '2025-06-01', qty: '6', price: '210', fee: '4.6' }),
    op({
      type: 'div',
      assetId: 'aapl',
      date: '2025-07-01',
      amount: '8.5',
      gross: '10',
      tax: '1.5',
    }),
    op({ type: 'buy', assetId: 'sxr', date: '2025-02-01', qty: '10', price: '90', fee: '1' }),
  ];
  const rows = computeHoldings(ops, [aapl, sxr], DEFAULT_FX_RATES, opts);
  const row = must(rows.find((r) => r.assetId === 'aapl'));

  it('matches the prototype in native currency', () => {
    expect(toPlain(row.qty)).toBe('9');
    expect(row.costN.toNumber()).toBeCloseTo(1443.2608695652, 8);
    expect(row.realizedN.toNumber()).toBeCloseTo(292.8260869565, 8);
    expect(row.avg.toNumber()).toBeCloseTo(160.3623188406, 8);
    expect(toPlain(row.valueN)).toBe('1800');
    expect(row.gainN.toNumber()).toBeCloseTo(356.7391304348, 8);
    expect(row.totalN.toNumber()).toBeCloseTo(658.0652173913, 8);
  });

  it('derives income, withholding and EUR values', () => {
    expect(toPlain(row.wht)).toBe('0.15');
    expect(toPlain(row.incomeN)).toBe('9');
    expect(toPlain(row.incomeNetN)).toBe('7.65');
    expect(toPlain(row.value)).toBe('1656');
    expect(row.cost.toNumber()).toBeCloseTo(1443.2608695652 * 0.92, 8);
  });

  it('weights open positions by EUR value', () => {
    const total = sum(rows.map((r) => r.value));
    expect(row.weight.toNumber()).toBeCloseTo(row.value.div(total).toNumber(), 12);
    expect(toPlain(sum(rows.map((r) => r.weight)))).toBe('1');
  });

  it('realized gain per sale in EUR and native', () => {
    const gains = realizedGainsPerSale(ops, [aapl, sxr], DEFAULT_FX_RATES);
    const sale = must(gains[must(ops[2]).id]);
    expect(sale.cost.toNumber()).toBeCloseTo(885.2, 8);
    expect(sale.proceeds.toNumber()).toBeCloseTo(1154.6, 8);
    expect(sale.gain.toNumber()).toBeCloseTo(269.4, 8);
    expect(sale.gainN.toNumber()).toBeCloseTo(292.8260869565, 8);
    expect(Object.keys(gains)).toEqual([must(ops[2]).id]);
  });
});

describe('computeHoldings — invariants', () => {
  it('selling everything leaves qty 0 and cost 0 for any quantities', () => {
    for (const [buyA, buyB, price] of [
      ['0.1', '0.2', '3.3333'],
      ['1234.9144', '596.7909', '7.6881'],
      ['0.00000001', '33', '0.1'],
    ] as const) {
      const ops = [
        op({
          type: 'buy',
          assetId: 'aapl',
          date: '2025-01-01',
          qty: buyA,
          price: '1.7',
          fee: '0.3',
        }),
        op({ type: 'buy', assetId: 'aapl', date: '2025-02-01', qty: buyB, price }),
        op({
          type: 'sell',
          assetId: 'aapl',
          date: '2025-03-01',
          qty: toPlain(add(buyA, buyB)),
          price: '2',
        }),
      ];
      const [row] = computeHoldings(ops, [aapl], DEFAULT_FX_RATES, opts);
      expect(toPlain(must(row).qty)).toBe('0');
      expect(toPlain(must(row).costN)).toBe('0');
      expect(must(row).isOpen).toBe(false);
      expect(toPlain(must(row).weight)).toBe('0');
    }
  });

  it('caps a sell at the held quantity (prototype behaviour)', () => {
    const ops = [
      op({ type: 'buy', assetId: 'sxr', date: '2025-01-01', qty: '10', price: '90' }),
      op({ type: 'sell', assetId: 'sxr', date: '2025-02-01', qty: '25', price: '100' }),
    ];
    const [row] = computeHoldings(ops, [sxr], DEFAULT_FX_RATES, opts);
    expect(toPlain(must(row).qty)).toBe('0');
    expect(toPlain(must(row).costN)).toBe('0');
    expect(toPlain(must(row).realizedN)).toBe('100');
    // Proceeds in the cash effect still use the full quantity, like the prototype.
    expect(toPlain(cashEffect(must(ops[1]), sxr, DEFAULT_FX_RATES))).toBe('2500');
  });

  it('keeps closed positions that realized gains or dividends, drops untouched ones', () => {
    const rows = computeHoldings(
      [
        op({ type: 'buy', assetId: 'sxr', date: '2025-01-01', qty: '1', price: '90' }),
        op({ type: 'sell', assetId: 'sxr', date: '2025-02-01', qty: '1', price: '90' }),
      ],
      [sxr],
      DEFAULT_FX_RATES,
      opts,
    );
    expect(rows).toEqual([]);
  });

  it('only counts operations up to asOf and ignores unknown assets and other portfolios', () => {
    const ops = [
      op({
        type: 'buy',
        assetId: 'sxr',
        date: '2025-01-01',
        qty: '1',
        price: '90',
        portfolioId: 'p1',
      }),
      op({
        type: 'buy',
        assetId: 'sxr',
        date: '2025-06-01',
        qty: '2',
        price: '90',
        portfolioId: 'p2',
      }),
      op({ type: 'buy', assetId: 'ghost', date: '2025-01-01', qty: '2', price: '90' }),
    ];
    const asOfMarch = computeHoldings(ops, [sxr], DEFAULT_FX_RATES, {
      ...opts,
      asOf: '2025-03-01',
    });
    expect(toPlain(must(asOfMarch[0]).qty)).toBe('1');
    const p2 = computeHoldings(ops, [sxr], DEFAULT_FX_RATES, { ...opts, portfolioIds: ['p2'] });
    expect(toPlain(must(p2[0]).qty)).toBe('2');
  });
});

describe('computeHoldings — same-day trades', () => {
  it('applies buys before sells on the same date regardless of input order', () => {
    const sell = op({ type: 'sell', assetId: 'sxr', date: '2025-01-01', qty: '5', price: '110' });
    const buy = op({ type: 'buy', assetId: 'sxr', date: '2025-01-01', qty: '5', price: '100' });
    const [row] = computeHoldings([sell, buy], [sxr], DEFAULT_FX_RATES, opts);
    expect(toPlain(must(row).qty)).toBe('0');
    expect(toPlain(must(row).realizedN)).toBe('50');
  });
});

describe('realizedGainsPerSale', () => {
  it('counts proceeds only for the units held when a sell exceeds the position', () => {
    const buy = op({ type: 'buy', assetId: 'sxr', date: '2025-01-01', qty: '10', price: '10' });
    const sell = op({ type: 'sell', assetId: 'sxr', date: '2025-02-01', qty: '15', price: '20' });
    const gains = realizedGainsPerSale([buy, sell], [sxr], DEFAULT_FX_RATES);
    expect(toPlain(must(gains[sell.id]).gain)).toBe('100');
    const [row] = computeHoldings([buy, sell], [sxr], DEFAULT_FX_RATES, opts);
    expect(toPlain(must(row).realizedN)).toBe('100');
  });

  it('ignores operations on unknown assets', () => {
    const ghost = op({ type: 'sell', assetId: 'ghost', date: '2025-01-01', qty: '1', price: '1' });
    expect(realizedGainsPerSale([ghost], [sxr], DEFAULT_FX_RATES)).toEqual({});
  });

  it('processes buys before sells on the same date regardless of input order', () => {
    const sell = op({ type: 'sell', assetId: 'sxr', date: '2025-01-01', qty: '5', price: '110' });
    const buy = op({ type: 'buy', assetId: 'sxr', date: '2025-01-01', qty: '5', price: '100' });
    const gains = realizedGainsPerSale([sell, buy], [sxr], DEFAULT_FX_RATES);
    expect(toPlain(must(gains[sell.id]).gain)).toBe('50');
  });

  it('keeps separate average costs per account and sub-account', () => {
    const buyA = op({
      type: 'buy',
      assetId: 'sxr',
      date: '2025-01-01',
      qty: '1',
      price: '100',
      accountId: 'a',
    });
    const buyB = op({
      type: 'buy',
      assetId: 'sxr',
      date: '2025-01-02',
      qty: '1',
      price: '200',
      accountId: 'b',
    });
    const sellA = op({
      type: 'sell',
      assetId: 'sxr',
      date: '2025-02-01',
      qty: '1',
      price: '150',
      accountId: 'a',
    });
    const gains = realizedGainsPerSale([buyA, buyB, sellA], [sxr], DEFAULT_FX_RATES);
    expect(toPlain(must(gains[sellA.id]).gain)).toBe('50');
    expect(positionKey(buyA)).not.toBe(positionKey(buyB));
  });
});

describe('cashEffect', () => {
  const buy = op({
    type: 'buy',
    assetId: 'aapl',
    date: '2025-01-01',
    qty: '10',
    price: '150',
    fee: '5',
  });
  const sell = op({
    type: 'sell',
    assetId: 'aapl',
    date: '2025-01-01',
    qty: '6',
    price: '210',
    fee: '4.6',
  });
  const dividend = op({ type: 'div', assetId: 'aapl', date: '2025-01-01', amount: '8.5' });

  it('is EUR: buy out, sell and dividend in, fees already in EUR', () => {
    expect(toPlain(cashEffect(buy, aapl, DEFAULT_FX_RATES))).toBe('-1385');
    expect(toPlain(cashEffect(sell, aapl, DEFAULT_FX_RATES))).toBe('1154.6');
    expect(toPlain(cashEffect(dividend, aapl, DEFAULT_FX_RATES))).toBe('7.82');
  });

  it('native variant converts the fee back to the asset currency', () => {
    expect(cashEffectNative(buy, aapl, DEFAULT_FX_RATES).toNumber()).toBeCloseTo(-1505.4347826, 6);
    expect(cashEffectNative(dividend, aapl, DEFAULT_FX_RATES).toString()).toBe('8.5');
  });

  it('uses rate 1 for an unknown asset', () => {
    expect(toPlain(cashEffect(sell, undefined, DEFAULT_FX_RATES))).toBe('1255.4');
  });
});

describe('priceAt', () => {
  const asset: InvestmentAsset = {
    id: 'x',
    currency: 'EUR',
    price: '10',
    prices: [
      { date: '2025-03-01', price: '8' },
      { date: '2025-01-01', price: '6' },
    ],
  };

  it('uses history before today, the current price otherwise', () => {
    expect(toPlain(priceAt(asset, '2025-02-01', TODAY))).toBe('6');
    expect(toPlain(priceAt(asset, '2025-03-01', TODAY))).toBe('8');
    expect(toPlain(priceAt(asset, '2024-01-01', TODAY))).toBe('10');
    expect(toPlain(priceAt(asset, TODAY, TODAY))).toBe('10');
    expect(toPlain(priceAt({ ...asset, prices: [] }, '2025-02-01', TODAY))).toBe('10');
  });
});
