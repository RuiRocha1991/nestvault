import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  RealEstateCandidate,
  RealEstateParserClient,
  RealEstateParserResponse,
} from '@nestvault/services';

// A stand-in for the parser service in the real estate import tests. By default it answers what
// the real parser makes of the anonymized mortgage workbook (`mortgage-workbook.expected.json`,
// written by services/parser's tests), so the totals are the reference ones.

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'mortgage');

export const mortgageWorkbookResponse = (): RealEstateParserResponse =>
  JSON.parse(
    readFileSync(join(FIXTURES, 'mortgage-workbook.expected.json'), 'utf8'),
  ) as RealEstateParserResponse;

export type RealEstateRow = RealEstateParserResponse['rows'][number];

export function realEstateResponse(
  rows: RealEstateRow[],
  parserId = 'fake-real-estate',
  costs: RealEstateParserResponse['meta']['acquisition_costs'] = null,
): RealEstateParserResponse {
  return {
    rows,
    meta: {
      parser_id: parserId,
      parser_version: '1',
      row_count: rows.length,
      acquisition_costs: costs,
      sheets: [],
    },
    warnings: [],
  };
}

export const installmentRow = (
  number: number,
  patch: Partial<Extract<RealEstateRow, { kind: 'installment' }>> = {},
): RealEstateRow => ({
  kind: 'installment',
  number,
  due_date: `2026-${String(number).padStart(2, '0')}-05`,
  capital: '100',
  interest: '20',
  fees: '0',
  stamp_tax: '0',
  life_insurance: '0',
  home_insurance: '0',
  credit_insurance: '0',
  ...patch,
});

export interface FakeRealEstateParser extends RealEstateParserClient {
  candidates: RealEstateCandidate[];
  response: RealEstateParserResponse;
  /** What the pipeline asked, in order: `detect`, `parse:<id>`. */
  calls: string[];
  reset(): void;
}

export function createFakeRealEstateParser(): FakeRealEstateParser {
  const fake: FakeRealEstateParser = {
    candidates: [{ parser_id: 'mortgage-workbook-xlsx', version: '1.0.0', confidence: 1 }],
    response: mortgageWorkbookResponse(),
    calls: [],
    detectRealEstate() {
      fake.calls.push('detect');
      return Promise.resolve(fake.candidates);
    },
    parseRealEstate(_data, parserId) {
      fake.calls.push(`parse:${parserId}`);
      return Promise.resolve(fake.response);
    },
    reset() {
      fake.candidates = [{ parser_id: 'mortgage-workbook-xlsx', version: '1.0.0', confidence: 1 }];
      fake.response = mortgageWorkbookResponse();
      fake.calls = [];
    },
  };
  return fake;
}
