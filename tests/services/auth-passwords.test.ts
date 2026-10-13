import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  hashPassword,
  isPasswordBreached,
  isSignupAllowed,
  NO_INVITES,
  verifyPassword,
} from '@nestvault/services';

describe('argon2id passwords', () => {
  it('hashes with argon2id and verifies only the right password', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword({ hash: stored, password: 'correct horse battery' })).toBe(true);
    expect(await verifyPassword({ hash: stored, password: 'wrong horse battery' })).toBe(false);
  });

  it('treats a malformed stored hash as a failed login', async () => {
    expect(await verifyPassword({ hash: 'not-a-hash', password: 'whatever-password' })).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password 123')).not.toBe(
      await hashPassword('same password 123'),
    );
  });
});

describe('isPasswordBreached', () => {
  const sha1 = (value: string) => createHash('sha1').update(value).digest('hex').toUpperCase();
  const reply = (body: string, status = 200) =>
    vi.fn(() => Promise.resolve(new Response(body, { status })));

  it('sends only the 5-character prefix and finds the suffix in the answer', async () => {
    const hash = sha1('password123456');
    const fetchMock = reply(`0000000000000000000000000000000000A:2\n${hash.slice(5)}:9001\n`);
    expect(await isPasswordBreached('password123456', { fetch: fetchMock })).toBe(true);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url.endsWith(hash.slice(0, 5))).toBe(true);
    expect(url).not.toContain(hash.slice(5));
  });

  it('ignores padding entries with a count of 0', async () => {
    const hash = sha1('a-unique-passphrase-9');
    expect(
      await isPasswordBreached('a-unique-passphrase-9', { fetch: reply(`${hash.slice(5)}:0\n`) }),
    ).toBe(false);
  });

  it('is false when the password is not in the answer', async () => {
    expect(await isPasswordBreached('a-unique-passphrase-9', { fetch: reply('ABC:3\n') })).toBe(
      false,
    );
  });

  it('fails open and warns when the service is down', async () => {
    const warn = vi.fn();
    const down = vi.fn(() => Promise.reject(new Error('offline')));
    const log = { warn } as unknown as Parameters<typeof isPasswordBreached>[1] extends infer O
      ? O extends { log?: infer L }
        ? L
        : never
      : never;
    expect(await isPasswordBreached('anything-at-all-1', { fetch: down, log })).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(await isPasswordBreached('anything-at-all-1', { fetch: reply('', 503) })).toBe(false);
  });
});

describe('isSignupAllowed', () => {
  const base = { email: 'a@example.com', inviteToken: undefined, invites: NO_INVITES };

  it('is open only when ALLOW_SIGNUP is true', async () => {
    expect(await isSignupAllowed({ ...base, allowSignup: true })).toBe(true);
    expect(await isSignupAllowed({ ...base, allowSignup: false })).toBe(false);
  });

  it('accepts a valid invite for the same email when closed', async () => {
    const invites = { isValid: vi.fn(() => Promise.resolve(true)) };
    expect(
      await isSignupAllowed({
        allowSignup: false,
        email: 'a@example.com',
        inviteToken: 't',
        invites,
      }),
    ).toBe(true);
    expect(invites.isValid).toHaveBeenCalledWith({ token: 't', email: 'a@example.com' });
  });

  it('rejects an invalid or missing invite token', async () => {
    expect(await isSignupAllowed({ ...base, allowSignup: false, inviteToken: 'forged' })).toBe(
      false,
    );
  });
});
