import { describe, expect, it } from 'vitest';

import {
  EnvValidationError,
  loadEnv,
  loadMigratorEnv,
  loadTestEnv,
} from '@nestvault/config/schema';

import { VALID_ENV, VALID_MIGRATOR_ENV, VALID_TEST_ENV, without } from './fixtures';

function messageFor(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error.message;
    throw error;
  }
  throw new Error('expected the environment to be rejected');
}

describe('loadEnv', () => {
  it('parses a valid environment', () => {
    const env = loadEnv(VALID_ENV);
    expect(env.APP_URL).toBe('http://localhost:4000');
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.ALLOW_SIGNUP).toBe(false);
    expect(env.SMTP_USER).toBeUndefined();
    expect(env.NODE_ENV).toBe('test');
  });

  it('defaults NODE_ENV to development and ALLOW_SIGNUP to false', () => {
    const env = loadEnv(without(VALID_ENV, ['NODE_ENV', 'ALLOW_SIGNUP']));
    expect(env.NODE_ENV).toBe('development');
    expect(env.ALLOW_SIGNUP).toBe(false);
  });

  it('does not include the migration user in the runtime environment', () => {
    const env = loadEnv({ ...VALID_ENV, ...VALID_MIGRATOR_ENV });
    expect(Object.keys(env).some((key) => key.startsWith('MIGRATOR'))).toBe(false);
  });

  describe('missing variables', () => {
    it('names every missing variable and prints no value', () => {
      const rest = without(VALID_ENV, ['BETTER_AUTH_SECRET', 'SMTP_HOST']);
      const message = messageFor(rest);
      expect(message).toContain('BETTER_AUTH_SECRET: is required');
      expect(message).toContain('SMTP_HOST: is required');
      for (const value of Object.values(rest)) {
        if (value.length > 3) expect(message).not.toContain(value);
      }
    });

    it('reports an empty environment as all required variables', () => {
      const message = messageFor({});
      for (const name of [
        'APP_URL',
        'DATABASE_URL_IDENTITY',
        'DATABASE_URL_APP',
        'APP_ENCRYPTION_KEY',
      ]) {
        expect(message).toContain(name);
      }
    });
  });

  describe('secrets', () => {
    it('rejects a BETTER_AUTH_SECRET shorter than 32 characters without echoing it', () => {
      const message = messageFor({ ...VALID_ENV, BETTER_AUTH_SECRET: 'too-short-secret' });
      expect(message).toContain('BETTER_AUTH_SECRET');
      expect(message).not.toContain('too-short-secret');
    });

    it('accepts exactly 32 characters', () => {
      expect(() => loadEnv({ ...VALID_ENV, BETTER_AUTH_SECRET: 'x'.repeat(32) })).not.toThrow();
      expect(() => loadEnv({ ...VALID_ENV, BETTER_AUTH_SECRET: 'x'.repeat(31) })).toThrow(
        EnvValidationError,
      );
    });

    it('requires APP_ENCRYPTION_KEY to be base64 for exactly 32 bytes', () => {
      for (const bad of [
        Buffer.alloc(16).toString('base64'),
        Buffer.alloc(33).toString('base64'),
        'not base64 at all!',
        '',
      ]) {
        const message = messageFor({ ...VALID_ENV, APP_ENCRYPTION_KEY: bad });
        expect(message).toContain('APP_ENCRYPTION_KEY');
        if (bad.length > 3) expect(message).not.toContain(bad);
      }
    });

    it('accepts a list of id:base64 keys for rotation, and still one plain key', () => {
      const first = Buffer.alloc(32, 1).toString('base64');
      const second = Buffer.alloc(32, 2).toString('base64');
      expect(
        loadEnv({ ...VALID_ENV, APP_ENCRYPTION_KEY: `new:${first},old:${second}` }),
      ).toBeTruthy();
      expect(loadEnv({ ...VALID_ENV, APP_ENCRYPTION_KEY: first })).toBeTruthy();
      expect(messageFor({ ...VALID_ENV, APP_ENCRYPTION_KEY: `a:${first},a:${second}` })).toContain(
        'APP_ENCRYPTION_KEY',
      );
    });

    it('rejects values copied from .env.example without running pnpm env:init', () => {
      const message = messageFor({ ...VALID_ENV, BETTER_AUTH_SECRET: '__BETTER_AUTH_SECRET__' });
      expect(message).toContain('BETTER_AUTH_SECRET');
      expect(message).toContain('pnpm env:init');
      const urlMessage = messageFor({
        ...VALID_ENV,
        DATABASE_URL_APP: 'postgres://app_rw:__APP_RW_PASSWORD__@127.0.0.1:5433/nestvault_app',
      });
      expect(urlMessage).toContain('DATABASE_URL_APP');
    });
  });

  describe('ALLOW_SIGNUP', () => {
    it.each([
      ['true', true],
      ['false', false],
    ])('parses %s', (raw, expected) => {
      expect(loadEnv({ ...VALID_ENV, ALLOW_SIGNUP: raw }).ALLOW_SIGNUP).toBe(expected);
    });

    it.each(['TRUE', '1', '0', 'yes', 'no', 'on', ' true', 'false '])(
      'rejects the ambiguous value %j instead of guessing',
      (raw) => {
        expect(() => loadEnv({ ...VALID_ENV, ALLOW_SIGNUP: raw })).toThrow(EnvValidationError);
      },
    );
  });

  describe('APP_URL', () => {
    it('normalizes to an origin', () => {
      expect(loadEnv({ ...VALID_ENV, APP_URL: 'https://cofre.example.com/' }).APP_URL).toBe(
        'https://cofre.example.com',
      );
    });

    it('allows http only for localhost', () => {
      for (const host of ['localhost', '127.0.0.1']) {
        expect(() => loadEnv({ ...VALID_ENV, APP_URL: `http://${host}:4000` })).not.toThrow();
      }
      expect(() => loadEnv({ ...VALID_ENV, APP_URL: 'http://cofre.example.com' })).toThrow(
        EnvValidationError,
      );
    });

    it.each([
      'localhost:4000',
      'ftp://localhost',
      'https://user:pw@cofre.example.com',
      'https://cofre.example.com/app',
      'https://cofre.example.com/?x=1',
      '',
    ])('rejects %j', (raw) => {
      expect(() => loadEnv({ ...VALID_ENV, APP_URL: raw })).toThrow(EnvValidationError);
    });
  });

  describe('database URLs', () => {
    it('requires a postgres URL with user, host and database', () => {
      for (const bad of [
        'mysql://u:p@127.0.0.1/db',
        'postgres://127.0.0.1/db',
        'postgres://u:p@127.0.0.1',
        'not a url',
        '',
      ]) {
        const message = messageFor({ ...VALID_ENV, DATABASE_URL_APP: bad });
        expect(message).toContain('DATABASE_URL_APP');
      }
    });

    it('never echoes the credentials of a rejected URL', () => {
      const message = messageFor({
        ...VALID_ENV,
        DATABASE_URL_APP: 'mysql://someone:super-secret-pw@127.0.0.1/db',
      });
      expect(message).not.toContain('super-secret-pw');
      expect(message).not.toContain('someone');
    });

    it('rejects identity and app URLs that point at the same database', () => {
      const message = messageFor({
        ...VALID_ENV,
        DATABASE_URL_APP: VALID_ENV.DATABASE_URL_IDENTITY,
      });
      expect(message).toContain('DATABASE_URL_APP');
      expect(message).toContain('different database');
    });
  });

  describe('SMTP', () => {
    it.each(['0', '65536', 'abc', '10.5', '-1', '', '1025abc'])('rejects SMTP_PORT %j', (raw) => {
      expect(() => loadEnv({ ...VALID_ENV, SMTP_PORT: raw })).toThrow(EnvValidationError);
    });

    it('keeps optional credentials when set and treats empty as unset', () => {
      const env = loadEnv({ ...VALID_ENV, SMTP_USER: 'mailer', SMTP_PASSWORD: 'pw-for-mail' });
      expect(env.SMTP_USER).toBe('mailer');
      expect(env.SMTP_PASSWORD).toBe('pw-for-mail');
      expect(loadEnv({ ...VALID_ENV, SMTP_USER: '' }).SMTP_USER).toBeUndefined();
    });
  });
});

describe('loadMigratorEnv', () => {
  it('parses the migration user connections', () => {
    expect(loadMigratorEnv(VALID_MIGRATOR_ENV).MIGRATOR_URL_APP).toContain('/nestvault_app');
  });

  it('names a missing connection and rejects two URLs for the same database', () => {
    expect(() => loadMigratorEnv({})).toThrow(/MIGRATOR_URL_IDENTITY: is required/);
    expect(() =>
      loadMigratorEnv({
        MIGRATOR_URL_IDENTITY: VALID_MIGRATOR_ENV.MIGRATOR_URL_APP,
        MIGRATOR_URL_APP: VALID_MIGRATOR_ENV.MIGRATOR_URL_APP,
      }),
    ).toThrow(/different database/);
  });
});

describe('loadTestEnv', () => {
  it('parses the test database connections', () => {
    expect(loadTestEnv(VALID_TEST_ENV).TEST_DATABASE_URL_APP).toContain('nestvault_app_test');
  });

  it('names a missing connection', () => {
    expect(() => loadTestEnv({})).toThrow(/TEST_DATABASE_URL_IDENTITY: is required/);
  });
});
