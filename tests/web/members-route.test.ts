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
const USER = '0197a6a0-0000-7000-8000-000000000003';

const members = {
  list: vi.fn(),
  changeRole: vi.fn(),
  remove: vi.fn(),
  leave: vi.fn(),
  transferOwnership: vi.fn(),
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
  getMembersService: () => Promise.resolve(members),
  getRateLimiter: () => Promise.resolve({ consume }),
}));
vi.mock('@nestvault/config', () => ({ env: { APP_URL: ORIGIN } }));

const collection = await import('../../apps/web/src/app/api/v1/pools/[poolId]/members/route');
const item = await import('../../apps/web/src/app/api/v1/pools/[poolId]/members/[userId]/route');
const transfer = await import('../../apps/web/src/app/api/v1/pools/[poolId]/transfer/route');
const leave = await import('../../apps/web/src/app/api/v1/pools/[poolId]/leave/route');

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
const itemParams = { params: Promise.resolve({ poolId: POOL, userId: USER }) };

const COLLECTION = `/api/v1/pools/${POOL}/members`;
const ITEM = `${COLLECTION}/${USER}`;
const TRANSFER = `/api/v1/pools/${POOL}/transfer`;
const LEAVE = `/api/v1/pools/${POOL}/leave`;
const FOREIGN = { origin: 'https://evil.example' };

beforeEach(() => {
  vi.clearAllMocks();
  signedInSession = SESSION;
});

describe('GET /api/v1/pools/{poolId}/members', () => {
  it('answers 401 without a session', async () => {
    signedInSession = null;
    expect((await collection.GET(request('GET', COLLECTION), poolParams)).status).toBe(401);
    expect(members.list).not.toHaveBeenCalled();
  });

  it('returns the service answer for the pool of the URL; 404 comes from the guard', async () => {
    members.list.mockResolvedValueOnce({ members: [] });
    const ok = await collection.GET(request('GET', COLLECTION), poolParams);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ members: [] });
    expect(members.list).toHaveBeenCalledWith(expect.any(Headers), POOL);
    expect(consume).toHaveBeenCalledWith('api', 's1');

    members.list.mockRejectedValueOnce(new NotFoundError());
    expect((await collection.GET(request('GET', COLLECTION), poolParams)).status).toBe(404);
  });
});

describe('PATCH /api/v1/pools/{poolId}/members/{userId}', () => {
  const body = { role: 'viewer' };

  it('answers 401 without a session and refuses another origin and non-JSON bodies', async () => {
    signedInSession = null;
    expect((await item.PATCH(request('PATCH', ITEM, body), itemParams)).status).toBe(401);
    signedInSession = SESSION;
    expect((await item.PATCH(request('PATCH', ITEM, body, FOREIGN), itemParams)).status).toBe(403);
    const text = request('PATCH', ITEM, 'role=viewer', { 'content-type': 'text/plain' });
    expect((await item.PATCH(text, itemParams)).status).toBe(400);
    expect(members.changeRole).not.toHaveBeenCalled();
  });

  it('hands the pool and the member from the URL to the service, with the body untouched', async () => {
    members.changeRole.mockResolvedValueOnce({ id: USER, role: 'viewer' });
    const res = await item.PATCH(request('PATCH', ITEM, body), itemParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: USER, role: 'viewer' });
    expect(members.changeRole).toHaveBeenCalledWith(expect.any(Headers), POOL, USER, body);
  });

  it('leaves mass assignment to the strict schema of the service (400)', async () => {
    members.changeRole.mockRejectedValueOnce(new ValidationError());
    const extra = { role: 'viewer', poolId: 'x', userId: 'y' };
    expect((await item.PATCH(request('PATCH', ITEM, extra), itemParams)).status).toBe(400);
    expect(members.changeRole).toHaveBeenCalledWith(expect.any(Headers), POOL, USER, extra);
  });

  it.each([
    [new ForbiddenError(), 403],
    [new NotFoundError(), 404],
    [new ConflictError(), 409],
    [new RateLimitError(30), 429],
  ])('maps %s to %i', async (error, status) => {
    members.changeRole.mockRejectedValueOnce(error);
    expect((await item.PATCH(request('PATCH', ITEM, body), itemParams)).status).toBe(status);
  });

  it('never echoes the password of an owner promotion, not even in an error body', async () => {
    const promotion = { role: 'owner', password: 'a-long-unique-passphrase' };
    members.changeRole.mockRejectedValueOnce(
      new ValidationError('The request is not valid.', [
        { path: 'password', message: 'incorrect' },
      ]),
    );
    const res = await item.PATCH(request('PATCH', ITEM, promotion), itemParams);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain(promotion.password);
    expect(members.changeRole).toHaveBeenCalledWith(expect.any(Headers), POOL, USER, promotion);
  });

  it('refuses an oversized body before reading it all', async () => {
    const res = await item.PATCH(request('PATCH', ITEM, { role: 'x'.repeat(2000) }), itemParams);
    expect(res.status).toBe(413);
    expect(members.changeRole).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/pools/{poolId}/members/{userId}', () => {
  it('answers 401 without a session and 403 for another origin', async () => {
    signedInSession = null;
    expect((await item.DELETE(request('DELETE', ITEM), itemParams)).status).toBe(401);
    signedInSession = SESSION;
    expect(
      (await item.DELETE(request('DELETE', ITEM, undefined, FOREIGN), itemParams)).status,
    ).toBe(403);
    expect(members.remove).not.toHaveBeenCalled();
  });

  it('removes with 204 and no body; the guards and the last-owner rule come from the service', async () => {
    members.remove.mockResolvedValueOnce(undefined);
    const res = await item.DELETE(request('DELETE', ITEM), itemParams);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(members.remove).toHaveBeenCalledWith(expect.any(Headers), POOL, USER);

    members.remove.mockRejectedValueOnce(new ForbiddenError());
    expect((await item.DELETE(request('DELETE', ITEM), itemParams)).status).toBe(403);
    members.remove.mockRejectedValueOnce(new ConflictError());
    expect((await item.DELETE(request('DELETE', ITEM), itemParams)).status).toBe(409);
    members.remove.mockRejectedValueOnce(new NotFoundError());
    expect((await item.DELETE(request('DELETE', ITEM), itemParams)).status).toBe(404);
  });
});

describe('POST /api/v1/pools/{poolId}/leave', () => {
  it('answers 401 without a session and 403 for another origin', async () => {
    signedInSession = null;
    expect((await leave.POST(request('POST', LEAVE), poolParams)).status).toBe(401);
    signedInSession = SESSION;
    expect((await leave.POST(request('POST', LEAVE, undefined, FOREIGN), poolParams)).status).toBe(
      403,
    );
    expect(members.leave).not.toHaveBeenCalled();
  });

  it('answers 204, and 409 for the only owner and 404 for a non-member from the service', async () => {
    members.leave.mockResolvedValueOnce(undefined);
    const res = await leave.POST(request('POST', LEAVE), poolParams);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(members.leave).toHaveBeenCalledWith(expect.any(Headers), POOL);

    members.leave.mockRejectedValueOnce(new ConflictError());
    expect((await leave.POST(request('POST', LEAVE), poolParams)).status).toBe(409);
    members.leave.mockRejectedValueOnce(new NotFoundError());
    expect((await leave.POST(request('POST', LEAVE), poolParams)).status).toBe(404);
  });
});

describe('POST /api/v1/pools/{poolId}/transfer', () => {
  const body = { userId: USER, password: 'a-long-unique-passphrase' };

  it('answers 401 without a session, 403 for another origin and 400 for non-JSON', async () => {
    signedInSession = null;
    expect((await transfer.POST(request('POST', TRANSFER, body), poolParams)).status).toBe(401);
    signedInSession = SESSION;
    expect((await transfer.POST(request('POST', TRANSFER, body, FOREIGN), poolParams)).status).toBe(
      403,
    );
    const text = request('POST', TRANSFER, 'x', { 'content-type': 'text/plain' });
    expect((await transfer.POST(text, poolParams)).status).toBe(400);
    expect(members.transferOwnership).not.toHaveBeenCalled();
  });

  it('hands the pool from the URL and the body to the service', async () => {
    members.transferOwnership.mockResolvedValueOnce({ poolId: POOL, role: 'admin' });
    const res = await transfer.POST(request('POST', TRANSFER, body), poolParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ poolId: POOL, role: 'admin' });
    expect(members.transferOwnership).toHaveBeenCalledWith(expect.any(Headers), POOL, body);
  });

  it('never echoes the password, not even in an error body', async () => {
    members.transferOwnership.mockRejectedValueOnce(
      new ValidationError('The request is not valid.', [
        { path: 'password', message: 'incorrect' },
      ]),
    );
    const res = await transfer.POST(request('POST', TRANSFER, body), poolParams);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain(body.password);
  });

  it.each([
    [new ForbiddenError(), 403],
    [new NotFoundError(), 404],
    [new ConflictError(), 409],
    [new RateLimitError(900), 429],
  ])('maps %s to %i', async (error, status) => {
    members.transferOwnership.mockRejectedValueOnce(error);
    expect((await transfer.POST(request('POST', TRANSFER, body), poolParams)).status).toBe(status);
  });

  it('refuses an oversized body before reading it all', async () => {
    const res = await transfer.POST(
      request('POST', TRANSFER, { ...body, password: 'x'.repeat(5000) }),
      poolParams,
    );
    expect(res.status).toBe(413);
    expect(members.transferOwnership).not.toHaveBeenCalled();
  });
});
