import { describe, expect, it, vi } from 'vitest';

import {
  createParserClient,
  UnprocessableError,
  UnsupportedMediaTypeError,
  UpstreamError,
  ValidationError,
} from '@nestvault/services';

const SECRET = 'test-parser-secret-0123456789-abcdefghij';
const BANK_RESPONSE = {
  rows: [
    {
      kind: 'bank',
      date: '2026-01-05',
      description: 'Coffee',
      amount: '-1.20',
      balance: null,
      external_id: null,
    },
  ],
  meta: {
    parser_id: 'p',
    parser_version: '1',
    row_count: 1,
    opening_balance: null,
    closing_balance: null,
    reconciled: null,
  },
  warnings: [],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function client(answer: () => Response | Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(answer()));
  const parser = createParserClient({
    url: 'http://127.0.0.1:8100/',
    secret: SECRET,
    fetch: fetchMock,
  });
  return { parser, fetchMock };
}

describe('parser client', () => {
  it('detect sends the file with the secret and returns the candidates', async () => {
    const { parser, fetchMock } = client(() =>
      json({ results: [{ parser_id: 'a', kind: 'bank', version: '1', confidence: 0.9 }] }),
    );
    const results = await parser.detect(Buffer.from('bytes'));
    expect(results).toEqual([{ parser_id: 'a', kind: 'bank', version: '1', confidence: 0.9 }]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:8100/detect');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['x-parser-secret']).toBe(SECRET);
    expect(Buffer.from(init?.body as Buffer).toString()).toBe('bytes');
    expect(init?.redirect).toBe('error');
  });

  it('parse puts the parser id in the query, encoded', async () => {
    const { parser, fetchMock } = client(() => json(BANK_RESPONSE));
    const parsed = await parser.parse(Buffer.from('x'), 'trade republic/pdf');
    expect(parsed.rows).toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:8100/parse?parser_id=trade%20republic%2Fpdf',
    );
  });

  it('parseWithSpec sends the mapping as base64url JSON in X-Import-Spec', async () => {
    const { parser, fetchMock } = client(() => json(BANK_RESPONSE));
    const spec = { id: 'generic-csv-1', version: 1 };
    await parser.parseWithSpec(Buffer.from('x'), spec);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:8100/parse-spec');
    const header = (init?.headers as Record<string, string>)['x-import-spec'] ?? '';
    expect(header).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual(spec);
  });

  it('propose returns the spec, the header and the preview', async () => {
    const { parser } = client(() =>
      json({ spec: { id: 'generic-csv-1' }, header: ['Data', 'Valor'], preview: BANK_RESPONSE }),
    );
    const proposal = await parser.propose(Buffer.from('x'));
    expect(proposal.header).toEqual(['Data', 'Valor']);
    expect(proposal.preview.rows).toHaveLength(1);
  });

  it('refuses an answer that does not match the schema (extra field, bad amount)', async () => {
    for (const body of [
      { ...BANK_RESPONSE, extra: 1 },
      { ...BANK_RESPONSE, rows: [{ ...BANK_RESPONSE.rows[0], amount: '1,5' }] },
      { ...BANK_RESPONSE, rows: [{ ...BANK_RESPONSE.rows[0], kind: 'other' }] },
      {},
    ]) {
      const { parser } = client(() => json(body));
      await expect(parser.parse(Buffer.from('x'), 'p')).rejects.toBeInstanceOf(UpstreamError);
    }
  });

  it('maps the parser refusals to the pipeline errors without forwarding its message', async () => {
    const cases: [number, string, new (...args: never[]) => Error][] = [
      [404, 'unknown_parser', ValidationError],
      [415, 'unsupported_file', UnsupportedMediaTypeError],
      [413, 'file_too_large', UnprocessableError],
      [422, 'parse_failed', UnprocessableError],
      [422, 'unsafe_archive', UnprocessableError],
      [422, 'invalid_spec', ValidationError],
      [401, 'unauthorized', UpstreamError],
      [500, 'worker_crashed', UpstreamError],
      [504, 'timeout', UpstreamError],
    ];
    for (const [status, code, error] of cases) {
      const { parser } = client(() =>
        json({ code, message: 'PT50 0000 secret detail from the parser' }, status),
      );
      const failure = await parser.parse(Buffer.from('x'), 'p').catch((e: unknown) => e);
      expect(failure, `${status} ${code}`).toBeInstanceOf(error);
      expect((failure as Error).message).not.toContain('PT50');
    }
  });

  it('turns a network failure and a timeout into an upstream error', async () => {
    const down = createParserClient({
      url: 'http://127.0.0.1:8100',
      secret: SECRET,
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(down.detect(Buffer.from('x'))).rejects.toBeInstanceOf(UpstreamError);

    const slow = createParserClient({
      url: 'http://127.0.0.1:8100',
      secret: SECRET,
      timeoutMs: 20,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'TimeoutError'));
          });
        })) as unknown as typeof fetch,
    });
    await expect(slow.detect(Buffer.from('x'))).rejects.toBeInstanceOf(UpstreamError);
  });

  it('treats a non-JSON error body as an upstream error', async () => {
    const { parser } = client(() => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(parser.detect(Buffer.from('x'))).rejects.toBeInstanceOf(UpstreamError);
  });

  it('refuses a mapping larger than the limit', async () => {
    const { parser } = client(() =>
      json({ spec: { x: 'y'.repeat(9000) }, header: [], preview: BANK_RESPONSE }),
    );
    await expect(parser.propose(Buffer.from('x'))).rejects.toBeInstanceOf(UpstreamError);
  });
});
