/** Passwords people pick first. The server also screens against known breaches (HIBP). */
const COMMON = new Set([
  'password',
  'password1',
  'passw0rd',
  'palavrapasse',
  'palavra-passe',
  'qwertyuiop',
  'qwertyuiopas',
  'asdfghjkl',
  '123456789012',
  '1234567890123',
  'abcdefghijkl',
  'iloveyou1234',
  'letmein12345',
  'benfica12345',
  'sporting1234',
]);

export const MIN_PASSWORD_LENGTH = 12;

function isTrivial(value: string): boolean {
  const lower = value.toLowerCase();
  if (COMMON.has(lower)) return true;
  if (new Set(lower).size <= 3) return true; // "aaaaaaaaaaaa", "abababababab"
  return /^(?:0123456789|1234567890|abcdefghij|qwertyuiop)/.test(lower) && lower.length < 16;
}

export interface PasswordCheck {
  longEnough: boolean;
  notCommon: boolean;
  /** 0 (empty or very weak) to 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
}

/** Client-side guidance only. The rules that count are enforced by the server. */
export function checkPassword(value: string): PasswordCheck {
  const longEnough = value.length >= MIN_PASSWORD_LENGTH;
  const notCommon = value.length > 0 && !isTrivial(value);
  if (value.length === 0) return { longEnough, notCommon, score: 0 };
  let score = 0;
  if (longEnough) score += 1;
  if (value.length >= 16) score += 1;
  if (/[a-z]/.test(value) && /[A-Z0-9]/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value) || value.length >= 20) score += 1;
  if (!notCommon) score = 0;
  if (!longEnough) score = Math.min(score, 1);
  return { longEnough, notCommon, score: Math.min(4, score) as PasswordCheck['score'] };
}
