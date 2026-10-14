import { PASSWORD_RULES } from '@nestvault/services/password-policy';

export interface PasswordCheck {
  longEnough: boolean;
  notCommon: boolean;
  /** True while the password does not contain the email (always true without an email). */
  notEmail: boolean;
  /** 0 (empty or very weak) to 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
}

/** Client-side guidance only. The rules that count are enforced by the server. */
export function checkPassword(value: string, email = ''): PasswordCheck {
  // The same rules as the server; an empty field meets none of them (nothing to say yet).
  const met = (id: (typeof PASSWORD_RULES)[number]['id']) =>
    value.length > 0 && !!PASSWORD_RULES.find((rule) => rule.id === id)?.passes(value, { email });
  const longEnough = met('length');
  const notCommon = met('common');
  const notEmail = met('email');
  if (value.length === 0) return { longEnough, notCommon, notEmail, score: 0 };
  let score = 0;
  if (longEnough) score += 1;
  if (value.length >= 16) score += 1;
  if (/[a-z]/.test(value) && /[A-Z0-9]/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value) || value.length >= 20) score += 1;
  if (!notCommon || !notEmail) score = 0;
  if (!longEnough) score = Math.min(score, 1);
  return { longEnough, notCommon, notEmail, score: Math.min(4, score) as PasswordCheck['score'] };
}
