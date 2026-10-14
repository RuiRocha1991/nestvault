import {
  isCommonPassword,
  isPasswordBasedOnEmail,
  PASSWORD_MIN_LENGTH,
} from '@nestvault/services/password-policy';

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
  const longEnough = value.length >= PASSWORD_MIN_LENGTH;
  const notCommon = value.length > 0 && !isCommonPassword(value);
  const notEmail = value.length > 0 && !isPasswordBasedOnEmail(value, email);
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
