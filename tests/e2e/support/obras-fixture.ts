import { readFileSync } from 'node:fs';

type Json = Record<string, unknown>;

/**
 * The anonymized prototype export plus a portfolio like the user's "Obras": no assets and no
 * operations, only linked accounts: a savings account that holds cash with a little interest and a
 * group of term deposits. No dividends anywhere in it.
 */
export function exportWithObras(): Json {
  const base = JSON.parse(
    readFileSync(
      new URL('../../fixtures/prototype-export.anonymized.json', import.meta.url),
      'utf8',
    ),
  ) as Json & { portfolios: Json[]; accounts: Json[]; interest: Json[] };
  const deposit = (id: string, start: string, capital: number, n: number) => ({
    id,
    name: `DP BPI+ (${n})`,
    type: 'prazo',
    bank: 'BPI',
    members: ['m1', 'm2'],
    member: 'm1',
    opening: 0,
    openingDate: start,
    rate: 1,
    ccy: 'EUR',
    capital,
    start,
    termMonths: 12,
    termN: 12,
    termU: 'm',
    payN: 3,
    payU: 'm',
    payTo: '',
    fundFrom: '',
    tax: 28,
    capitalize: true,
    group: 'DP BPI+',
    pf: 'p3',
    subs: [],
    trackCash: true,
  });
  return {
    ...base,
    portfolios: [
      ...base.portfolios,
      { id: 'p3', name: 'Obras', color: '#C9A227', ccy: 'EUR', note: '', targets: {} },
    ],
    accounts: [
      ...base.accounts,
      {
        id: 'a7',
        name: 'XTB 2921911',
        type: 'remunerada',
        bank: 'XTB',
        members: ['m1'],
        member: 'm1',
        opening: 600,
        openingDate: '2026-01-02',
        rate: 0,
        ccy: 'EUR',
        subs: [],
        group: '',
        pf: 'p3',
        trackCash: true,
      },
      deposit('a8', '2026-01-10', 1000, 1),
      deposit('a9', '2026-03-10', 800, 2),
      deposit('a10', '2026-06-10', 600, 3),
    ],
    interest: [
      ...base.interest,
      { id: 'i9', acc: 'a7', date: '2026-06-30', amount: 0.18, rate: null },
    ],
  };
}
