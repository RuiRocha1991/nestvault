import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ServicesModule from '@nestvault/services';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@nestvault/services';

const ORIGIN = 'http://localhost:4000';
const SESSION = { userId: 'u1', sessionId: 's1', expiresAt: new Date(), name: 'Ana' };
const POOL = '0192f3a1-0000-7000-8000-000000000001';

const service = { run: vi.fn() };
const consume = vi.fn();
let signedInSession: typeof SESSION | null = SESSION;

vi.mock('@nestvault/services', async (importOriginal) => ({
  ...(await importOriginal<typeof ServicesModule>()),
  requireSession: () => {
    if (!signedInSession) throw new UnauthorizedError();
    return Promise.resolve(signedInSession);
  },
}));
vi.mock('@webapp/server/auth', () => ({
  getAuth: () => Promise.resolve({}),
  getPrototypeImportService: () => Promise.resolve(service),
  getRateLimiter: () => Promise.resolve({ consume }),
}));
vi.mock('@nestvault/config', () => ({ env: { APP_URL: ORIGIN } }));

const route = await import('../../apps/web/src/app/api/v1/pools/[poolId]/import-prototype/route');

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/v1/pools/${POOL}/import-prototype`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const params = { params: Promise.resolve({ poolId: POOL }) };
const RESULT = { dryRun: true, counts: { accounts: 1 }, warnings: [] };

beforeEach(() => {
  vi.clearAllMocks();
  signedInSession = SESSION;
});

describe('POST /api/v1/pools/:poolId/import-prototype', () => {
  it('answers 401 without a session and calls nothing', async () => {
    signedInSession = null;
    expect((await route.POST(post({ dryRun: true, export: {} }), params)).status).toBe(401);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('refuses another origin (CSRF) and a body that is not JSON', async () => {
    const foreign = await route.POST(
      post({ dryRun: true, export: {} }, { origin: 'https://evil.example' }),
      params,
    );
    expect(foreign.status).toBe(403);
    const text = await route.POST(post('dryRun=true', { 'content-type': 'text/plain' }), params);
    expect(text.status).toBe(400);
    const broken = await route.POST(post('{"dryRun": tru'), params);
    expect(broken.status).toBe(400);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('hands the untouched body and the pool of the URL to the service, under the api rate limit', async () => {
    service.run.mockResolvedValue(RESULT);
    const body = { dryRun: true, export: { v: 6, accounts: [] } };
    const res = await route.POST(post(body), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RESULT);
    expect(service.run).toHaveBeenCalledWith(expect.any(Headers), POOL, body);
    expect(consume).toHaveBeenCalledWith('api', 's1');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['400', new ValidationError('x', [{ path: 'export.tx.0', message: 'no' }]), 400],
    ['403', new ForbiddenError(), 403],
    ['404', new NotFoundError(), 404],
    ['409', new ConflictError(), 409],
  ])('passes the service’s %s through with the public error body', async (_name, error, status) => {
    service.run.mockRejectedValueOnce(error);
    const res = await route.POST(post({ dryRun: false, export: {} }), params);
    expect(res.status).toBe(status);
    const body = (await res.json()) as { error: { code: string }; requestId: string };
    expect(body.error.code).toEqual(expect.any(String));
    expect(body.requestId).toEqual(expect.any(String));
  });

  it('accepts a file of several megabytes but refuses one over 10 MB before reading it all', async () => {
    service.run.mockResolvedValue(RESULT);
    const big = { dryRun: true, export: { exportedAt: 'x'.repeat(4 * 1024 * 1024) } };
    expect((await route.POST(post(big), params)).status).toBe(200);
    const huge = post(
      '{"dryRun":true,"export":{"exportedAt":"' + 'x'.repeat(10 * 1024 * 1024 + 2048) + '"}}',
    );
    expect((await route.POST(huge, params)).status).toBe(413);
    expect(service.run).toHaveBeenCalledTimes(1);
  });
});
