import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createParserClient,
  TEMPLATE_NAMES,
  templateText,
  UnprocessableError,
  UpstreamError,
} from '@nestvault/services';

import { mortgageWorkbookResponse } from '../support/real-estate-imports';

const SECRET = 'test-parser-secret-0123456789-abcdefghij';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function client(answer: () => Response) {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(answer()));
  const parser = createParserClient({
    url: 'http://127.0.0.1:8100/',
    secret: SECRET,
    fetch: fetchMock,
  });
  return { parser, fetchMock };
}

describe('parser client: real estate endpoints', () => {
  it('detectRealEstate posts the file with the secret to /real-estate/detect', async () => {
    const { parser, fetchMock } = client(() =>
      json({
        results: [{ parser_id: 'mortgage-workbook-xlsx', version: '1.0.0', confidence: 1 }],
      }),
    );
    const results = await parser.detectRealEstate(Buffer.from('bytes'));
    expect(results).toEqual([
      { parser_id: 'mortgage-workbook-xlsx', version: '1.0.0', confidence: 1 },
    ]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:8100/real-estate/detect');
    expect((init?.headers as Record<string, string>)['x-parser-secret']).toBe(SECRET);
    expect(init?.redirect).toBe('error');
  });

  it('parseRealEstate puts the parser id in the query and validates the rows it gets', async () => {
    const { parser, fetchMock } = client(() => json(mortgageWorkbookResponse()));
    const response = await parser.parseRealEstate(Buffer.from('x'), 'mortgage workbook/xlsx');
    expect(response.rows).toHaveLength(92);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:8100/real-estate/parse?parser_id=mortgage%20workbook%2Fxlsx',
    );
  });

  it('refuses an answer with an unknown row kind, an extra field or a bad amount', async () => {
    const good = mortgageWorkbookResponse();
    const first = good.rows[0];
    for (const body of [
      { ...good, extra: 1 },
      { ...good, rows: [{ ...first, kind: 'statement' }] },
      { ...good, rows: [{ ...first, capital: '1,5' }] },
      { ...good, rows: [{ ...first, number: 0 }] },
      {},
    ]) {
      const { parser } = client(() => json(body));
      await expect(parser.parseRealEstate(Buffer.from('x'), 'p')).rejects.toBeInstanceOf(
        UpstreamError,
      );
    }
  });

  it('maps a parse failure to 422 without forwarding the parser message', async () => {
    const { parser } = client(() =>
      json({ code: 'parse_failed', message: 'PT50 0000 secret detail' }, 422),
    );
    const failure = await parser.parseRealEstate(Buffer.from('x'), 'p').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UnprocessableError);
    expect((failure as Error).message).not.toContain('PT50');
  });
});

describe('the CSV templates', () => {
  const parserTemplates = join(import.meta.dirname, '..', '..', 'services', 'parser', 'templates');

  it('are the same text the parser service reads back (services/parser/templates)', () => {
    for (const name of TEMPLATE_NAMES) {
      const onDisk = readFileSync(join(parserTemplates, `${name}.csv`), 'utf8');
      expect(templateText(name).text).toBe(onDisk);
    }
  });

  it('only exist under their own names', () => {
    for (const name of ['constructor', '__proto__', 'toString', '../x', '']) {
      expect(() => templateText(name)).toThrow();
    }
  });
});
