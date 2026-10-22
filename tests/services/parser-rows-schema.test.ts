import { describe, expect, it } from 'vitest';

import { parserResponseSchema } from '@nestvault/services';

const meta = { parser_id: 'x', parser_version: '1.0.0', row_count: 1 };
const bank = { kind: 'bank', date: '2026-01-05', description: 'Coffee', amount: '-1.20' };
const broker = {
  kind: 'broker',
  date: '2026-01-05',
  type: 'dividend',
  symbol: 'AAA',
  amount: '1.50',
  currency: 'USD',
};

describe('parserResponseSchema (generated from services/parser/schemas/rows.schema.json)', () => {
  it('accepts what the parser service sends for bank and broker rows', () => {
    const parsed = parserResponseSchema.parse({ rows: [bank, broker], meta, warnings: ['w'] });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.meta.reconciled).toBeNull();
  });

  it.each([
    ['unknown row kind', { rows: [{ ...bank, kind: 'card' }] }],
    ['unknown field on a row', { rows: [{ ...bank, extra: 1 }] }],
    ['unknown field on the response', { rows: [bank], injected: true }],
    ['non-ISO date', { rows: [{ ...bank, date: '05/01/2026' }] }],
    ['decimal comma', { rows: [{ ...bank, amount: '1,5' }] }],
    ['numeric amount', { rows: [{ ...bank, amount: 1.5 }] }],
    ['lower-case currency', { rows: [{ ...broker, currency: 'usd' }] }],
    ['unknown broker type', { rows: [{ ...broker, type: 'gift' }] }],
    ['oversized description', { rows: [{ ...bank, description: 'x'.repeat(501) }] }],
  ])('rejects %s', (_name, patch) => {
    expect(parserResponseSchema.safeParse({ meta, warnings: [], ...patch }).success).toBe(false);
  });
});
