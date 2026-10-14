import { describe, expect, it } from 'vitest';

import {
  isPasswordProblem,
  PASSWORD_PROBLEM_BY_CODE,
  passwordProblemOf,
} from '@webapp/lib/password-problem';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

describe('passwordProblemOf', () => {
  it.each(Object.entries(PASSWORD_PROBLEM_BY_CODE))('maps %s to %s', (code, key) => {
    expect(passwordProblemOf(code)).toBe(key);
  });

  it.each([null, '', 'INVALID_PASSWORD', 'INVALID_EMAIL', 'toString', '__proto__', 'constructor'])(
    'returns null for %j',
    (code) => {
      expect(passwordProblemOf(code)).toBeNull();
    },
  );

  it('narrows form states with isPasswordProblem', () => {
    expect(isPasswordProblem('tooShort')).toBe(true);
    expect(isPasswordProblem('error')).toBe(false);
    expect(isPasswordProblem('saved')).toBe(false);
  });

  it('has a message for every problem in each form that shows it', () => {
    for (const key of Object.values(PASSWORD_PROBLEM_BY_CODE)) {
      expect(messages.auth.signup, `signup.${key}`).toHaveProperty(key);
      expect(messages.auth.reset, `reset.${key}`).toHaveProperty(key);
      expect(messages.account.password, `account.password.${key}`).toHaveProperty(key);
    }
  });
});
