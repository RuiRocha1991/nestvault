import { describe, expect, it } from 'vitest';

import {
  firstFailedPasswordRule,
  isCommonPassword,
  isPasswordBasedOnEmail,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
} from '@nestvault/services/password-policy';

describe('password policy', () => {
  it('shares the length limits with the server', () => {
    expect([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]).toEqual([12, 128]);
  });

  it('knows the common and trivial passwords, whatever their case', () => {
    for (const value of ['Palavra-Passe', 'QWERTYUIOP12', 'aaaaaaaaaaaaaaaa', 'abababababab']) {
      expect(isCommonPassword(value), value).toBe(true);
    }
    expect(isCommonPassword('correct-horse-battery')).toBe(false);
  });

  it('flags a password that contains the email or a long enough name part of it', () => {
    expect(isPasswordBasedOnEmail('ana.silva@example.com', 'ana.silva@example.com')).toBe(true);
    expect(isPasswordBasedOnEmail('xx-ANA.SILVA@example.com-xx', 'ana.silva@example.com')).toBe(
      true,
    );
    expect(isPasswordBasedOnEmail('my-anabelasilva-1', 'anabelasilva@example.com')).toBe(true);
  });

  it('lets short name parts, other words and a missing email through', () => {
    expect(isPasswordBasedOnEmail('my-ana-secret-phrase', 'ana@example.com')).toBe(false);
    expect(isPasswordBasedOnEmail('correct-horse-battery', 'ana@example.com')).toBe(false);
    expect(isPasswordBasedOnEmail('anything-at-all-123', '')).toBe(false);
  });
});

describe('password rules', () => {
  const email = 'ana.silva@example.com';

  it('lists the rules in the order they are checked', () => {
    expect(PASSWORD_RULES.map((rule) => rule.code)).toEqual([
      'PASSWORD_TOO_SHORT',
      'PASSWORD_TOO_COMMON',
      'PASSWORD_BASED_ON_EMAIL',
    ]);
  });

  it.each([
    ['', 'PASSWORD_TOO_SHORT'],
    ['short-pass', 'PASSWORD_TOO_SHORT'],
    ['palavra-passe', 'PASSWORD_TOO_COMMON'],
    ['aaaaaaaaaaaaaaaa', 'PASSWORD_TOO_COMMON'],
    [`xx-${email}-xx`, 'PASSWORD_BASED_ON_EMAIL'],
    ['my-ana.silva-secret', 'PASSWORD_BASED_ON_EMAIL'],
    ['correct-horse-battery', null],
  ])('%j fails with %s', (password, code) => {
    expect(firstFailedPasswordRule(password, { email })?.code ?? null).toBe(code);
  });

  it('skips the email rule when the address is not known', () => {
    expect(firstFailedPasswordRule('my-ana.silva-secret')).toBeNull();
    expect(firstFailedPasswordRule('my-ana.silva-secret', { email: undefined })).toBeNull();
  });
});
