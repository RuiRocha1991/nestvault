import { describe, expect, it } from 'vitest';

import { loadPublicEnv } from '@nestvault/config/public';

describe('loadPublicEnv', () => {
  it('defaults the app name', () => {
    expect(loadPublicEnv({}).appName).toBe('Cofre Familiar');
    expect(loadPublicEnv({ NEXT_PUBLIC_APP_NAME: '   ' }).appName).toBe('Cofre Familiar');
  });

  it('uses and trims a configured name', () => {
    expect(loadPublicEnv({ NEXT_PUBLIC_APP_NAME: '  Cofre da Casa ' }).appName).toBe(
      'Cofre da Casa',
    );
  });

  it('rejects an over-long name', () => {
    expect(() => loadPublicEnv({ NEXT_PUBLIC_APP_NAME: 'x'.repeat(61) })).toThrow(
      'NEXT_PUBLIC_APP_NAME',
    );
  });

  it('is frozen and exposes nothing else, whatever else is in the source', () => {
    const result = loadPublicEnv({
      NEXT_PUBLIC_APP_NAME: 'X',
      BETTER_AUTH_SECRET: 'leak-me',
      DATABASE_URL_APP: 'postgres://u:p@h/d',
    });
    expect(Object.keys(result)).toEqual(['appName']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('leak-me');
  });
});
