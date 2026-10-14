import { describe, expect, it } from 'vitest';

import { PASSWORD_MIN_LENGTH } from '@nestvault/services/password-policy';
import { checkPassword } from '@webapp/lib/password-strength';

describe('checkPassword', () => {
  it('scores an empty field as 0 and flags nothing as met', () => {
    expect(checkPassword('')).toEqual({
      longEnough: false,
      notCommon: false,
      notEmail: false,
      score: 0,
    });
  });

  it('requires 12 characters', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(checkPassword('Abc123!').longEnough).toBe(false);
    expect(checkPassword('Abc123!').score).toBeLessThanOrEqual(1);
    expect(checkPassword('abcdef-ghijkl').longEnough).toBe(true);
  });

  it('rejects common and trivial passwords at score 0', () => {
    for (const value of [
      'password1',
      'qwertyuiop',
      'aaaaaaaaaaaaaaaa',
      'abababababababab',
      '1234567890123',
    ]) {
      const result = checkPassword(value);
      expect(result.notCommon, value).toBe(false);
      expect(result.score, value).toBe(0);
    }
  });

  it('gives a long mixed passphrase the top score', () => {
    const result = checkPassword('correct-Horse-battery-staple-9');
    expect(result).toEqual({ longEnough: true, notCommon: true, notEmail: true, score: 4 });
  });

  it('grows with length and variety', () => {
    const scores = ['abcdefghi-jkl', 'abcdefghi-jklmnop', 'Abcdefghi-jklmnop1'].map(
      (v) => checkPassword(v).score,
    );
    expect(scores[0]).toBeLessThanOrEqual(scores[1] ?? 0);
    expect(scores[1]).toBeLessThanOrEqual(scores[2] ?? 0);
  });
});

describe('checkPassword with an email', () => {
  it('flags a password that contains the email or its name part', () => {
    expect(checkPassword('xx-ana.silva@example.com-xx', 'ana.silva@example.com').notEmail).toBe(
      false,
    );
    expect(checkPassword('my-anabelasilva-secret', 'anabelasilva@example.com').notEmail).toBe(
      false,
    );
    expect(checkPassword('my-anabelasilva-secret', 'anabelasilva@example.com').score).toBe(0);
  });

  it('does not flag short name parts or unrelated passwords', () => {
    expect(checkPassword('my-ana-secret-phrase', 'ana@example.com').notEmail).toBe(true);
    expect(checkPassword('correct-horse-battery', 'ana@example.com').notEmail).toBe(true);
  });
});
