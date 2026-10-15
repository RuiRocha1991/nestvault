import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ServicesModule from '@nestvault/services';
import { ConflictError, UnauthorizedError, ValidationError } from '@nestvault/services';

const ORIGIN = 'http://localhost:4000';
const SESSION = { userId: 'u1', sessionId: 's1', expiresAt: new Date(), name: 'Ana' };

const pools = { create: vi.fn(), listMine: vi.fn(), open: vi.fn() };
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
  getPoolsService: () => Promise.resolve(pools),
  getRateLimiter: () => Promise.resolve({ consume }),
}));
vi.mock('@nestvault/config', () => ({ env: { APP_URL: ORIGIN } }));

const route = await import('../../apps/web/src/app/api/v1/pools/route');

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/v1/pools`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const noParams = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  signedInSession = SESSION;
});

describe('POST /api/v1/pools', () => {
  it('answers 401 without a session and creates nothing', async () => {
    signedInSession = null;
    expect((await route.POST(post({ name: 'Casa' }), noParams)).status).toBe(401);
    expect(pools.create).not.toHaveBeenCalled();
  });

  it('refuses another origin and bodies that are not JSON', async () => {
    const foreign = await route.POST(
      post({ name: 'Casa' }, { origin: 'https://evil.example' }),
      noParams,
    );
    expect(foreign.status).toBe(403);
    const text = await route.POST(post('name=Casa', { 'content-type': 'text/plain' }), noParams);
    expect(text.status).toBe(400);
    expect(pools.create).not.toHaveBeenCalled();
  });

  it('creates the pool for the session user with 201 and counts the request against the api limit', async () => {
    pools.create.mockResolvedValue({ id: 'p1', name: 'Casa', role: 'owner' });
    const res = await route.POST(post({ name: 'Casa' }), noParams);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'p1', name: 'Casa', role: 'owner' });
    expect(pools.create).toHaveBeenCalledWith(expect.any(Headers), { name: 'Casa' });
    expect(consume).toHaveBeenCalledWith('api', 's1');
  });

  it('hands the body to the service untouched, so it can refuse extra fields (400)', async () => {
    pools.create.mockRejectedValueOnce(new ValidationError());
    const res = await route.POST(post({ name: 'Casa', role: 'owner', ownerId: 'x' }), noParams);
    expect(res.status).toBe(400);
    expect(pools.create).toHaveBeenCalledWith(expect.any(Headers), {
      name: 'Casa',
      role: 'owner',
      ownerId: 'x',
    });
  });

  it('answers 409 at the ownership cap', async () => {
    pools.create.mockRejectedValueOnce(new ConflictError());
    expect((await route.POST(post({ name: 'Casa' }), noParams)).status).toBe(409);
  });

  it('refuses an oversized body before reading it all', async () => {
    const res = await route.POST(post({ name: 'x'.repeat(5000) }), noParams);
    expect(res.status).toBe(413);
    expect(pools.create).not.toHaveBeenCalled();
  });
});
