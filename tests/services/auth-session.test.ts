import { describe, expect, it, vi } from 'vitest';

import {
  getOptionalSession,
  requireSession,
  UnauthorizedError,
  type Auth,
} from '@nestvault/services';

const expiresAt = new Date('2026-11-12T10:00:00Z');

function authReturning(result: unknown) {
  const getSession = vi.fn(() => Promise.resolve(result));
  return { auth: { api: { getSession } } as unknown as Auth, getSession };
}

const found = {
  user: { id: 'user-1', name: 'Ana', email: 'ana@example.test' },
  session: { id: 'session-1', expiresAt, token: 'secret-token' },
};

describe('getOptionalSession', () => {
  it('returns the session without the token or the email', async () => {
    const { auth, getSession } = authReturning(found);
    const headers = new Headers({ cookie: 'nv.session_token=x' });
    const session = await getOptionalSession(auth, headers);
    expect(getSession).toHaveBeenCalledWith({ headers });
    expect(session).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      expiresAt,
      name: 'Ana',
    });
  });

  it('returns null when there is no valid session', async () => {
    const { auth } = authReturning(null);
    expect(await getOptionalSession(auth, new Headers())).toBeNull();
  });
});

describe('requireSession', () => {
  it('returns the session', async () => {
    const { auth } = authReturning(found);
    expect((await requireSession(auth, new Headers())).userId).toBe('user-1');
  });

  it('throws 401 when there is no session', async () => {
    const { auth } = authReturning(null);
    await expect(requireSession(auth, new Headers())).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
