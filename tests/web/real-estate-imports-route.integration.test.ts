import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { logger, RealEstateCommitResultDto, RealEstatePreviewDto } from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { APP_URL } from '../support/auth-harness';
import { ErrorEnvelope, strictly } from '../support/strict-schema';

// The three routes of the real estate import take multipart/form-data or answer text/csv, which the
// generated cases of the isolation suite (JSON bodies) cannot exercise. This file runs the checks of
// that table against the real Route Handlers, the real service and Postgres, with the parser
// service replaced by a stub.

const holder = vi.hoisted(() => ({ world: undefined as unknown as ApiWorld }));

vi.mock('@webapp/server/auth', () => ({
  getAuth: () => Promise.resolve(holder.world.auth),
  getRateLimiter: () => Promise.resolve(holder.world.limiter),
  getRealEstateImportsService: () => Promise.resolve(holder.world.realEstateImports),
}));
vi.mock('@nestvault/config', () => ({ env: { APP_URL: 'http://localhost:4000' } }));

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const WORKBOOK = readFileSync(
  join(import.meta.dirname, '..', 'fixtures', 'mortgage', 'mortgage-workbook.anonymized.xlsx'),
);
const ROUTES = '../../apps/web/src/app/api/v1/pools/[poolId]/real-estate-imports';

type CommitResult = z.infer<typeof RealEstateCommitResultDto>;

let s: Scenario;

beforeAll(async () => {
  logger.level = 'silent';
  holder.world = await createApiWorld();
});

beforeEach(async () => {
  s = await holder.world.newScenario();
  holder.world.realEstateKit.parser.reset();
});

afterAll(async () => {
  await holder.world.close();
});

interface Send {
  as?: Persona | null;
  poolId?: string;
  origin?: string | null;
  form?: FormData;
}

function upload(content: BlobPart = WORKBOOK, name = 'credito.xlsx', fields = {}) {
  const form = new FormData();
  form.set('file', new File([content], name));
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  return form;
}

async function post(which: 'preview' | 'commit', send: Send = {}) {
  const { as = 'owner', poolId = s.poolA, origin = APP_URL, form = upload() } = send;
  const { POST } = (await import(`${ROUTES}/${which}/route`)) as {
    POST: (req: Request, ctx: { params: Promise<{ poolId: string }> }) => Promise<Response>;
  };
  const headers = new Headers();
  if (as !== null) for (const [k, v] of (await s.as(as)).entries()) headers.set(k, v);
  if (origin !== null) headers.set('origin', origin);
  return POST(
    new Request(`${APP_URL}/api/v1/pools/${poolId}/real-estate-imports/${which}`, {
      method: 'POST',
      headers,
      body: form,
    }),
    { params: Promise.resolve({ poolId }) },
  );
}

async function template(name: string, as: Persona | null = 'owner', poolId = s.poolA) {
  const { GET } = (await import(`${ROUTES}/templates/[name]/route`)) as {
    GET: (
      req: Request,
      ctx: { params: Promise<{ poolId: string; name: string }> },
    ) => Promise<Response>;
  };
  const headers = new Headers();
  if (as !== null) for (const [k, v] of (await s.as(as)).entries()) headers.set(k, v);
  return GET(
    new Request(`${APP_URL}/api/v1/pools/${poolId}/real-estate-imports/templates/${name}`, {
      headers,
    }),
    {
      params: Promise.resolve({ poolId, name }),
    },
  );
}

async function errorOf(response: Response, status: number) {
  expect(response.status).toBe(status);
  const parsed = ErrorEnvelope.safeParse(await response.json());
  expect(parsed.success, 'the error body has the one public shape').toBe(true);
  return parsed.success ? parsed.data.error : undefined;
}

describe.each(['preview', 'commit'] as const)('POST /real-estate-imports/%s', (which) => {
  const parser = () => holder.world.realEstateKit.parser;

  it('401 without a session', async () => {
    await errorOf(await post(which, { as: null }), 401);
  });

  it('404 for a non-member, the same answer as for a pool that does not exist', async () => {
    const stranger = await errorOf(await post(which, { as: 'outsider' }), 404);
    const nowhere = await errorOf(
      await post(which, { poolId: '0198f000-0000-7000-8000-00000000dead' }),
      404,
    );
    expect(stranger).toEqual(nowhere);
  });

  it('403 for a viewer, and the file is never read', async () => {
    await errorOf(await post(which, { as: 'viewer' }), 403);
    expect(parser().calls).toEqual([]);
  });

  it('403 for a foreign or missing Origin', async () => {
    await errorOf(await post(which, { origin: 'https://evil.example' }), 403);
    await errorOf(await post(which, { origin: null }), 403);
    expect(parser().calls).toEqual([]);
  });

  it('413 for an 11 MB upload, refused before it is read into memory', async () => {
    const big = new Uint8Array(11 * 1024 * 1024).fill(0x61);
    await errorOf(await post(which, { form: upload(big, 'big.csv') }), 413);
    expect(parser().calls).toEqual([]);
  });

  it('415 for an executable renamed .xlsx', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 0), Buffer.from('DOS mode')]);
    await errorOf(await post(which, { form: upload(exe, 'credito.xlsx') }), 415);
    expect(parser().calls).toEqual([]);
  });

  it('400 for a field the form does not have, and for a second file', async () => {
    await errorOf(
      await post(which, { form: upload(WORKBOOK, 'credito.xlsx', { poolId: s.poolA }) }),
      400,
    );
    const twice = upload();
    twice.append('file', new File([WORKBOOK], 'again.xlsx'));
    await errorOf(await post(which, { form: twice }), 400);
  });

  it('400 for a loan id that is an SQL payload', async () => {
    const form = upload(WORKBOOK, 'credito.xlsx', { loanId: "' OR 1=1 --" });
    await errorOf(await post(which, { form }), 400);
  });
});

describe('POST /real-estate-imports/preview', () => {
  it('answers 200 with a preview that matches the schema exactly', async () => {
    const response = await post('preview');
    expect(response.status).toBe(200);
    const parsed = strictly(RealEstatePreviewDto).parse(await response.json());
    expect(parsed).toMatchObject({ parserId: 'mortgage-workbook-xlsx', rowCount: 92 });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('lets a member read a file (imports.run), who may not commit it', async () => {
    expect((await post('preview', { as: 'member' })).status).toBe(200);
    await errorOf(await post('commit', { as: 'member' }), 403);
  });
});

describe('POST /real-estate-imports/commit', () => {
  it('answers 200 with what was written, then 200 again with nothing new', async () => {
    const owner = await s.as('owner');
    const [holderRow] = (await holder.world.holders.list(owner, s.poolA)).holders;
    const property = await holder.world.properties.create(owner, s.poolA, {
      name: 'Casa',
      type: 'primary_home',
      purchaseDate: '2020-09-01',
      purchasePrice: '124000',
      holders: [{ holderId: holderRow?.id ?? '', sharePct: '100' }],
    });
    const loan = await holder.world.loans.create(owner, s.poolA, {
      name: 'Crédito habitação',
      kind: 'mortgage',
      propertyId: property.id,
      principal: '111600',
      startDate: '2020-09-01',
      firstDueDate: '2020-10-05',
      termMonths: 480,
      rateType: 'fixed',
      annualRate: '1.5',
      paymentDay: 5,
    });
    const first = await post('commit', {
      form: upload(WORKBOOK, 'credito.xlsx', { loanId: loan.id }),
    });
    expect(first.status).toBe(200);
    const body = strictly(RealEstateCommitResultDto).parse(await first.json()) as CommitResult;
    expect(body.result.installments.create).toBe(73);
    const second = strictly(RealEstateCommitResultDto).parse(
      await (
        await post('commit', { form: upload(WORKBOOK, 'credito.xlsx', { loanId: loan.id }) })
      ).json(),
    ) as CommitResult;
    expect(second.result.installments).toMatchObject({ create: 0, update: 0, unchanged: 73 });
  });

  it('400 when the loan the file needs is missing', async () => {
    await errorOf(await post('commit'), 400);
  });
});

describe('GET /real-estate-imports/templates/:name', () => {
  it('serves each template as a CSV attachment', async () => {
    for (const name of ['loan-installments', 'works-payments']) {
      const response = await template(name);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="${name}.csv"`,
      );
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect((await response.text()).split('\n')[0]).toContain(';');
    }
  });

  it('401, 404 and 403 like every pool route; 404 for an unknown template', async () => {
    await errorOf(await template('loan-installments', null), 401);
    await errorOf(await template('loan-installments', 'outsider'), 404);
    await errorOf(await template('loan-installments', 'viewer'), 403);
    await errorOf(await template('nope'), 404);
    await errorOf(await template('..%2Fsecret'), 404);
  });
});
