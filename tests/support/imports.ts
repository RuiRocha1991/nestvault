import type {
  ImportSpecJson,
  MappingProposal,
  ParserCandidate,
  ParserClient,
  ParserResponse,
} from '@nestvault/services';

// A stand-in for the parser service in the import tests: it answers what the test says and
// remembers what it was asked. The real parser is covered by services/parser's own tests and the
// client by tests/services/imports-parser-client.test.ts.

export type FakeRow = ParserResponse['rows'][number];

export const bankRow = (
  date: string,
  description: string,
  amount: string,
  balance: string | null = null,
): FakeRow => ({
  kind: 'bank',
  date,
  description,
  amount,
  balance,
  external_id: null,
});

export const brokerRow = (overrides: Partial<Extract<FakeRow, { kind: 'broker' }>>): FakeRow => ({
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

export function responseOf(
  rows: FakeRow[],
  meta: Partial<ParserResponse['meta']> = {},
  warnings: string[] = [],
): ParserResponse {
  return {
    rows,
    meta: {
      parser_id: 'fake-parser',
      parser_version: '1',
      row_count: rows.length,
      opening_balance: null,
      closing_balance: null,
      reconciled: null,
      ...meta,
    },
    warnings,
  };
}

export const candidate = (
  parserId = 'fake-parser',
  confidence = 0.95,
  kind: 'bank' | 'broker' = 'bank',
): ParserCandidate => ({ parser_id: parserId, kind, version: '1', confidence });

export interface FakeParser extends ParserClient {
  candidates: ParserCandidate[];
  response: ParserResponse;
  proposal: MappingProposal | null;
  /** What the pipeline asked, in order: `detect`, `parse:<id>`, `spec`, `propose`. */
  calls: string[];
  /** The mapping of the last `parseWithSpec`. */
  lastSpec: ImportSpecJson | null;
  /** Makes `parseWithSpec` fail (a remembered mapping that no longer fits). */
  failSpec: Error | null;
  reset(): void;
}

export function createFakeParser(): FakeParser {
  const fake: FakeParser = {
    candidates: [candidate()],
    response: responseOf([bankRow('2026-01-05', 'Coffee', '-1.20')]),
    proposal: null,
    calls: [],
    lastSpec: null,
    failSpec: null,
    detect() {
      fake.calls.push('detect');
      return Promise.resolve(fake.candidates);
    },
    parse(_data, parserId) {
      fake.calls.push(`parse:${parserId}`);
      return Promise.resolve({
        ...fake.response,
        meta: { ...fake.response.meta, parser_id: parserId },
      });
    },
    propose() {
      fake.calls.push('propose');
      if (!fake.proposal) return Promise.reject(new Error('no proposal set'));
      return Promise.resolve(fake.proposal);
    },
    parseWithSpec(_data, spec) {
      fake.calls.push('spec');
      fake.lastSpec = spec;
      if (fake.failSpec) return Promise.reject(fake.failSpec);
      return Promise.resolve(fake.response);
    },
    reset() {
      fake.candidates = [candidate()];
      fake.response = responseOf([bankRow('2026-01-05', 'Coffee', '-1.20')]);
      fake.proposal = null;
      fake.calls = [];
      fake.lastSpec = null;
      fake.failSpec = null;
    },
  };
  return fake;
}
