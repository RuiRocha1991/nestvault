import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ServicesModule from '@nestvault/services';
import { NotFoundError, UnauthorizedError } from '@nestvault/services';

const ORIGIN = 'http://localhost:4000';
const SESSION = { userId: 'u1', sessionId: 's1', expiresAt: new Date(), name: 'Ana' };

const account = {
  getMe: vi.fn(),
  updateProfile: vi.fn(),
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
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
  getAccountService: () => Promise.resolve(account),
  getRateLimiter: () => Promise.resolve({ consume }),
}));
vi.mock('@nestvault/config', () => ({ env: { APP_URL: ORIGIN } }));

const me = await import('../../apps/web/src/app/api/v1/me/route');
const sessions = await import('../../apps/web/src/app/api/v1/me/sessions/route');
const oneSession = await import('../../apps/web/src/app/api/v1/me/sessions/[id]/route');

const write = (method: string, path: string, body?: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const noParams = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  signedInSession = SESSION;
});

describe('/api/v1/me', () => {
  it('answers 401 without a session, for every endpoint', async () => {
    signedInSession = null;
    const id = { params: Promise.resolve({ id: crypto.randomUUID() }) };
    const responses = await Promise.all([
      me.GET(new Request(`${ORIGIN}/api/v1/me`), noParams),
      me.PATCH(write('PATCH', '/api/v1/me', { name: 'x' }), noParams),
      sessions.GET(new Request(`${ORIGIN}/api/v1/me/sessions`), noParams),
      sessions.DELETE(write('DELETE', '/api/v1/me/sessions?others=true'), noParams),
      oneSession.DELETE(write('DELETE', '/api/v1/me/sessions/x'), id),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect(account.getMe).not.toHaveBeenCalled();
  });

  it('returns the profile from the service and counts the request against the api limit', async () => {
    account.getMe.mockResolvedValue({ id: 'x', name: 'Ana' });
    const res = await me.GET(new Request(`${ORIGIN}/api/v1/me`), noParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'x', name: 'Ana' });
    expect(consume).toHaveBeenCalledWith('api', 's1');
  });

  it('refuses writes from another origin and bodies that are not JSON', async () => {
    const foreign = new Request(`${ORIGIN}/api/v1/me`, {
      method: 'PATCH',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{"name":"x"}',
    });
    expect((await me.PATCH(foreign, noParams)).status).toBe(403);
    const text = new Request(`${ORIGIN}/api/v1/me`, {
      method: 'PATCH',
      headers: { origin: ORIGIN, 'content-type': 'text/plain' },
      body: 'name=x',
    });
    expect((await me.PATCH(text, noParams)).status).toBe(400);
    expect(account.updateProfile).not.toHaveBeenCalled();
  });

  it('passes the body to the service for validation', async () => {
    account.updateProfile.mockResolvedValue({ name: 'Ana' });
    await me.PATCH(write('PATCH', '/api/v1/me', { name: 'Ana' }), noParams);
    expect(account.updateProfile).toHaveBeenCalledWith(expect.any(Headers), { name: 'Ana' });
  });
});

describe('/api/v1/me/sessions', () => {
  it('lists the sessions', async () => {
    account.listSessions.mockResolvedValue({ sessions: [] });
    const res = await sessions.GET(new Request(`${ORIGIN}/api/v1/me/sessions`), noParams);
    expect(await res.json()).toEqual({ sessions: [] });
  });

  it('ends the others only with others=true', async () => {
    account.revokeOtherSessions.mockResolvedValue({ revoked: 2 });
    const bare = await sessions.DELETE(write('DELETE', '/api/v1/me/sessions'), noParams);
    expect(bare.status).toBe(400);
    const wrong = await sessions.DELETE(write('DELETE', '/api/v1/me/sessions?others=1'), noParams);
    expect(wrong.status).toBe(400);
    expect(account.revokeOtherSessions).not.toHaveBeenCalled();
    const ok = await sessions.DELETE(write('DELETE', '/api/v1/me/sessions?others=true'), noParams);
    expect(await ok.json()).toEqual({ revoked: 2 });
  });

  it('ends one session with 204, and answers 404 when it is not the user’s', async () => {
    const id = crypto.randomUUID();
    const params = { params: Promise.resolve({ id }) };
    account.revokeSession.mockResolvedValueOnce(undefined);
    const ok = await oneSession.DELETE(write('DELETE', `/api/v1/me/sessions/${id}`), params);
    expect(ok.status).toBe(204);
    expect(account.revokeSession).toHaveBeenCalledWith(expect.any(Headers), id);

    account.revokeSession.mockRejectedValueOnce(new NotFoundError());
    const other = await oneSession.DELETE(write('DELETE', `/api/v1/me/sessions/${id}`), params);
    expect(other.status).toBe(404);
  });
});
