import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ServicesModule from '@nestvault/services';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '@nestvault/services';

const ORIGIN = 'http://localhost:4000';
const SESSION = { userId: 'u1', sessionId: 's1', expiresAt: new Date(), name: 'Ana' };
const POOL = '0197a6a0-0000-7000-8000-000000000001';
const INVITE = '0197a6a0-0000-7000-8000-000000000002';
const TOKEN = 'A'.repeat(43);

const invites = {
  create: vi.fn(),
  listPending: vi.fn(),
  cancel: vi.fn(),
  resend: vi.fn(),
  preview: vi.fn(),
  accept: vi.fn(),
};
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
  getInvitesService: () => Promise.resolve(invites),
  getRateLimiter: () => Promise.resolve({ consume }),
}));
vi.mock('@nestvault/config', () => ({ env: { APP_URL: ORIGIN } }));

const collection = await import('../../apps/web/src/app/api/v1/pools/[poolId]/invites/route');
const item = await import('../../apps/web/src/app/api/v1/pools/[poolId]/invites/[id]/route');
const resend =
  await import('../../apps/web/src/app/api/v1/pools/[poolId]/invites/[id]/resend/route');
const accept = await import('../../apps/web/src/app/api/v1/invites/[token]/accept/route');

const request = (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });

const poolParams = { params: Promise.resolve({ poolId: POOL }) };
const itemParams = { params: Promise.resolve({ poolId: POOL, id: INVITE }) };
const tokenParams = { params: Promise.resolve({ token: TOKEN }) };

const COLLECTION = `/api/v1/pools/${POOL}/invites`;
const ITEM = `${COLLECTION}/${INVITE}`;
const ACCEPT = `/api/v1/invites/${TOKEN}/accept`;

const DTO = {
  id: INVITE,
  email: 'joao@example.test',
  role: 'member',
  expiresAt: '2026-01-08T10:00:00.000Z',
  createdAt: '2026-01-01T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  signedInSession = SESSION;
});

describe('POST /api/v1/pools/{poolId}/invites', () => {
  const body = { email: 'joao@example.test', role: 'member' };

  it('answers 401 without a session and creates nothing', async () => {
    signedInSession = null;
    expect((await collection.POST(request('POST', COLLECTION, body), poolParams)).status).toBe(401);
    expect(invites.create).not.toHaveBeenCalled();
  });

  it('refuses another origin, a missing origin and bodies that are not JSON', async () => {
    const foreign = request('POST', COLLECTION, body, { origin: 'https://evil.example' });
    expect((await collection.POST(foreign, poolParams)).status).toBe(403);
    const missing = new Request(`${ORIGIN}${COLLECTION}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect((await collection.POST(missing, poolParams)).status).toBe(403);
    const text = request('POST', COLLECTION, 'email=x', { 'content-type': 'text/plain' });
    expect((await collection.POST(text, poolParams)).status).toBe(400);
    expect(invites.create).not.toHaveBeenCalled();
  });

  it('creates the invite with 201, hands the pool id from the URL to the service and counts the api limit', async () => {
    invites.create.mockResolvedValue(DTO);
    const res = await collection.POST(request('POST', COLLECTION, body), poolParams);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(DTO);
    expect(invites.create).toHaveBeenCalledWith(expect.any(Headers), POOL, body);
    expect(consume).toHaveBeenCalledWith('api', 's1');
  });

  it('hands extra fields to the service untouched so it can refuse them (400)', async () => {
    invites.create.mockRejectedValueOnce(new ValidationError());
    const extra = { ...body, poolId: 'x', invitedBy: 'y' };
    expect((await collection.POST(request('POST', COLLECTION, extra), poolParams)).status).toBe(
      400,
    );
    expect(invites.create).toHaveBeenCalledWith(expect.any(Headers), POOL, extra);
  });

  it.each([
    [new ForbiddenError(), 403],
    [new NotFoundError(), 404],
    [new ConflictError(), 409],
    [new RateLimitError(120), 429],
  ])('maps %s to %i', async (error, status) => {
    invites.create.mockRejectedValueOnce(error);
    const res = await collection.POST(request('POST', COLLECTION, body), poolParams);
    expect(res.status).toBe(status);
    if (status === 429) expect(res.headers.get('retry-after')).toBe('120');
  });

  it('refuses an oversized body before reading it all', async () => {
    const res = await collection.POST(
      request('POST', COLLECTION, { email: 'x'.repeat(5000), role: 'member' }),
      poolParams,
    );
    expect(res.status).toBe(413);
    expect(invites.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/pools/{poolId}/invites', () => {
  it('answers 401 without a session', async () => {
    signedInSession = null;
    expect((await collection.GET(request('GET', COLLECTION), poolParams)).status).toBe(401);
    expect(invites.listPending).not.toHaveBeenCalled();
  });

  it('returns the service answer; 404 and 403 come from the service guards', async () => {
    invites.listPending.mockResolvedValueOnce({ invites: [DTO] });
    const ok = await collection.GET(request('GET', COLLECTION), poolParams);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ invites: [DTO] });
    expect(invites.listPending).toHaveBeenCalledWith(expect.any(Headers), POOL);

    invites.listPending.mockRejectedValueOnce(new NotFoundError());
    expect((await collection.GET(request('GET', COLLECTION), poolParams)).status).toBe(404);
    invites.listPending.mockRejectedValueOnce(new ForbiddenError());
    expect((await collection.GET(request('GET', COLLECTION), poolParams)).status).toBe(403);
  });
});

describe('DELETE /api/v1/pools/{poolId}/invites/{id}', () => {
  it('answers 401 without a session and 403 for another origin', async () => {
    signedInSession = null;
    expect((await item.DELETE(request('DELETE', ITEM), itemParams)).status).toBe(401);
    signedInSession = SESSION;
    const foreign = request('DELETE', ITEM, undefined, { origin: 'https://evil.example' });
    expect((await item.DELETE(foreign, itemParams)).status).toBe(403);
    expect(invites.cancel).not.toHaveBeenCalled();
  });

  it('cancels with 204 and no body; another pool’s id is the service’s 404', async () => {
    invites.cancel.mockResolvedValueOnce(undefined);
    const res = await item.DELETE(request('DELETE', ITEM), itemParams);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(invites.cancel).toHaveBeenCalledWith(expect.any(Headers), POOL, INVITE);

    invites.cancel.mockRejectedValueOnce(new NotFoundError());
    expect((await item.DELETE(request('DELETE', ITEM), itemParams)).status).toBe(404);
  });
});

describe('POST /api/v1/pools/{poolId}/invites/{id}/resend', () => {
  const path = `${ITEM}/resend`;

  it('answers 401 without a session and 403 for another origin', async () => {
    signedInSession = null;
    expect((await resend.POST(request('POST', path), itemParams)).status).toBe(401);
    signedInSession = SESSION;
    const foreign = request('POST', path, undefined, { origin: 'https://evil.example' });
    expect((await resend.POST(foreign, itemParams)).status).toBe(403);
    expect(invites.resend).not.toHaveBeenCalled();
  });

  it('resends and returns the invite; limits and guards come from the service', async () => {
    invites.resend.mockResolvedValueOnce(DTO);
    const res = await resend.POST(request('POST', path), itemParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DTO);
    expect(invites.resend).toHaveBeenCalledWith(expect.any(Headers), POOL, INVITE);

    invites.resend.mockRejectedValueOnce(new RateLimitError(60));
    expect((await resend.POST(request('POST', path), itemParams)).status).toBe(429);
    invites.resend.mockRejectedValueOnce(new ForbiddenError());
    expect((await resend.POST(request('POST', path), itemParams)).status).toBe(403);
  });
});

describe('POST /api/v1/invites/{token}/accept', () => {
  it('answers 401 without a session and 403 for another origin', async () => {
    signedInSession = null;
    expect((await accept.POST(request('POST', ACCEPT), tokenParams)).status).toBe(401);
    signedInSession = SESSION;
    const foreign = request('POST', ACCEPT, undefined, { origin: 'https://evil.example' });
    expect((await accept.POST(foreign, tokenParams)).status).toBe(403);
    expect(invites.accept).not.toHaveBeenCalled();
  });

  it('returns the joined pool; every refusal is the same 404 body', async () => {
    invites.accept.mockResolvedValueOnce({ poolId: POOL });
    const res = await accept.POST(request('POST', ACCEPT), tokenParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ poolId: POOL });
    expect(invites.accept).toHaveBeenCalledWith(expect.any(Headers), TOKEN);

    invites.accept.mockRejectedValue(new NotFoundError());
    const first = await accept.POST(request('POST', ACCEPT), tokenParams);
    const second = await accept.POST(request('POST', ACCEPT), tokenParams);
    expect(first.status).toBe(404);
    const firstError = ((await first.json()) as { error: unknown }).error;
    const secondError = ((await second.json()) as { error: unknown }).error;
    expect(firstError).toEqual(secondError);
    expect(JSON.stringify(firstError)).not.toContain(TOKEN);
  });
});
