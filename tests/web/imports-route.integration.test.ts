import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImportStartDto, logger } from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { APP_URL } from '../support/auth-harness';
import { ErrorEnvelope, strictly } from '../support/strict-schema';

// POST /api/v1/pools/:poolId/imports takes multipart/form-data, which the generated cases of the
// isolation suite (JSON bodies) cannot send. This file runs the checks of that table against the
// real Route Handler, the real service and Postgres, with the parser service replaced by a stub.

const holder = vi.hoisted(() => ({ world: undefined as unknown as ApiWorld }));

vi.mock('@webapp/server/auth', () => ({
  getAuth: () => Promise.resolve(holder.world.auth),
  getRateLimiter: () => Promise.resolve(holder.world.limiter),
  getImportsService: () => Promise.resolve(holder.world.imports),
}));
vi.mock('@nestvault/config', () => ({ env: { APP_URL: 'http://localhost:4000' } }));

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let s: Scenario;

beforeAll(async () => {
  logger.level = 'silent';
  holder.world = await createApiWorld();
});

beforeEach(async () => {
  s = await holder.world.newScenario();
  holder.world.importsKit.parser.reset();
});

afterAll(async () => {
  await holder.world.close();
});

const CSV = 'Data;Descrição;Valor\n05-01-2026;Coffee;-1,20\n';

interface Send {
  as?: Persona | null;
  poolId?: string;
  origin?: string | null;
  form?: FormData;
  headers?: Record<string, string>;
  body?: BodyInit;
}

function upload(
  content: BlobPart = CSV,
  name = 'extrato.csv',
  fields: Record<string, string> = {},
) {
  const form = new FormData();
  form.set('file', new File([content], name));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

async function post({
  as = 'owner',
  poolId = s.poolA,
  origin = APP_URL,
  form,
  headers,
  body,
}: Send = {}) {
  const { POST } = await import('../../apps/web/src/app/api/v1/pools/[poolId]/imports/route');
  const all = new Headers(headers);
  if (as !== null) for (const [k, v] of (await s.as(as)).entries()) all.set(k, v);
  if (origin !== null) all.set('origin', origin);
  const request = new Request(`${APP_URL}/api/v1/pools/${poolId}/imports`, {
    method: 'POST',
    headers: all,
    body: body ?? form ?? upload(),
  });
  return POST(request, { params: Promise.resolve({ poolId }) });
}

async function errorOf(response: Response, status: number) {
  expect(response.status).toBe(status);
  const parsed = ErrorEnvelope.safeParse(await response.json());
  expect(parsed.success, 'the error body has the one public shape').toBe(true);
  return parsed.success ? parsed.data.error : undefined;
}

describe('POST /imports', () => {
  it('answers 201 with a preview that matches the schema exactly', async () => {
    const response = await post();
    expect(response.status).toBe(201);
    const body: unknown = await response.json();
    const parsed = strictly(ImportStartDto).parse(body);
    expect(parsed).toMatchObject({ status: 'preview', kind: 'bank', fileName: 'extrato.csv' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 200 when the user has to choose a format', async () => {
    const { parser } = holder.world.importsKit;
    parser.candidates = [
      { parser_id: 'one', kind: 'bank', version: '1', confidence: 0.92 },
      { parser_id: 'two', kind: 'bank', version: '1', confidence: 0.9 },
    ];
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'choose-parser' });
  });

  it('401 without a session', async () => {
    await errorOf(await post({ as: null }), 401);
  });

  it('404 for a non-member, the same answer as for a pool that does not exist', async () => {
    const stranger = await errorOf(await post({ as: 'outsider' }), 404);
    const nowhere = await errorOf(
      await post({ poolId: '0198f000-0000-7000-8000-00000000dead' }),
      404,
    );
    expect(stranger).toEqual(nowhere);
  });

  it('403 for a viewer', async () => {
    await errorOf(await post({ as: 'viewer' }), 403);
  });

  it('403 for a foreign or missing Origin', async () => {
    await errorOf(await post({ origin: 'https://evil.example' }), 403);
    await errorOf(await post({ origin: null }), 403);
    expect(holder.world.importsKit.parser.calls).toEqual([]);
  });

  it('413 for an 11 MB upload, refused before it is read into memory', async () => {
    const big = new Uint8Array(11 * 1024 * 1024).fill(0x61);
    const response = await post({ form: upload(big, 'extrato.csv') });
    await errorOf(response, 413);
    expect(holder.world.importsKit.parser.calls).toEqual([]);
  });

  it('413 for a file just over the limit that fits the envelope allowance', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1).fill(0x61);
    await errorOf(await post({ form: upload(big) }), 413);
  });

  it('413 when the declared length lies, as soon as the real body passes the limit', async () => {
    const big = new Uint8Array(11 * 1024 * 1024).fill(0x61);
    const form = upload(big);
    const probe = new Request(APP_URL, { method: 'POST', body: form });
    const content = Buffer.from(await probe.arrayBuffer());
    const response = await post({
      body: content,
      headers: {
        'content-type': probe.headers.get('content-type') ?? '',
        'content-length': '1000',
      },
    });
    await errorOf(response, 413);
  });

  it('415 for an executable renamed .xlsx', async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0, 0, 0, 0x50, 0x45, 0, 0]);
    await errorOf(await post({ form: upload(exe, 'extrato.xlsx') }), 415);
    expect(holder.world.importsKit.parser.calls).toEqual([]);
  });

  it.each([
    ['an unknown field', () => upload(CSV, 'a.csv', { surprise: '1' })],
    ['a pool id', () => upload(CSV, 'a.csv', { poolId: '0198f000-0000-7000-8000-000000000001' })],
    ['a spec that is not JSON', () => upload(CSV, 'a.csv', { spec: '{nope' })],
    ['a parser and a spec together', () => upload(CSV, 'a.csv', { parserId: 'x', spec: '{}' })],
  ])('400 for %s', async (_name, form) => {
    await errorOf(await post({ form: form() }), 400);
    expect(holder.world.importsKit.parser.calls).toEqual([]);
  });

  it('400 without a file, with two files, and when the body is not multipart', async () => {
    await errorOf(await post({ form: new FormData() }), 400);
    const two = upload();
    two.append('file', new File([CSV], 'second.csv'));
    await errorOf(await post({ form: two }), 400);
    await errorOf(
      await post({
        body: JSON.stringify({ file: 'x' }),
        headers: { 'content-type': 'application/json' },
      }),
      400,
    );
    const asText = new FormData();
    asText.set('file', 'not a file');
    await errorOf(await post({ form: asText }), 400);
  });

  it('reads a confirmed column mapping sent as JSON text', async () => {
    const spec = { id: 'generic-csv-1', version: 1 };
    const response = await post({ form: upload(CSV, 'a.csv', { spec: JSON.stringify(spec) }) });
    expect(response.status).toBe(201);
    expect(holder.world.importsKit.parser.lastSpec).toEqual(spec);
  });

  it('never echoes the file name or content in an error', async () => {
    const response = await post({ form: upload(CSV, 'SALARIO-ACME.exe') });
    const text = await response.text();
    expect(response.status).toBe(415);
    expect(text).not.toContain('SALARIO');
  });
});
