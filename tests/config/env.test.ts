import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VALID_ENV } from './fixtures';

// Every variable the schema reads is set (or blanked) through stubEnv so each test starts clean.
const ALL_KEYS = Object.keys(VALID_ENV);

function stubEnvironment(overrides: Record<string, string | undefined> = {}): void {
  for (const key of ALL_KEYS) vi.stubEnv(key, undefined);
  for (const [key, value] of Object.entries({ ...VALID_ENV, ...overrides })) {
    vi.stubEnv(key, value);
  }
}

describe('the server entry point (@nestvault/config)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('exports a parsed, frozen env', async () => {
    stubEnvironment();
    const { env } = await import('@nestvault/config');
    expect(env.APP_URL).toBe('http://localhost:4000');
    expect(env.SMTP_PORT).toBe(1025);
    expect(Object.isFrozen(env)).toBe(true);
    expect(() => {
      (env as { APP_URL: string }).APP_URL = 'https://evil.example.com';
    }).toThrow(TypeError);
  });

  it('exits with code 1 and names the variable, never its value', async () => {
    const leaked = 'short-but-secret';
    stubEnvironment({ BETTER_AUTH_SECRET: leaked, SMTP_HOST: undefined });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit:${String(code)}`);
    });

    await expect(import('@nestvault/config')).rejects.toThrow('exit:1');

    const printed = error.mock.calls.flat().join('\n');
    expect(printed).toContain('BETTER_AUTH_SECRET');
    expect(printed).toContain('SMTP_HOST: is required');
    expect(printed).not.toContain(leaked);
    expect(printed).not.toContain(VALID_ENV.APP_ENCRYPTION_KEY);
  });
});
