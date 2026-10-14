// Pure rules about what a password may be. No imports, so the sign-up form (browser) and the
// server share one definition through `@nestvault/services/password-policy`. The server enforces
// them; the form only uses them to guide the user.

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

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

/** A password from the common list, a few repeated characters, or an obvious keyboard run. */
export function isCommonPassword(value: string): boolean {
  const lower = value.toLowerCase();
  if (COMMON.has(lower)) return true;
  if (new Set(lower).size <= 3) return true; // "aaaaaaaaaaaa", "abababababab"
  return /^(?:0123456789|1234567890|abcdefghij|qwertyuiop)/.test(lower) && lower.length < 16;
}

const MIN_LOCAL_PART_LENGTH = 6;

/** The password is the email, or contains it or (when long enough to mean something) its name part. */
export function isPasswordBasedOnEmail(password: string, email: string): boolean {
  const lower = password.toLowerCase();
  const address = email.trim().toLowerCase();
  if (address.length === 0) return false;
  if (lower.includes(address)) return true;
  const local = address.split('@')[0] ?? '';
  return local.length >= MIN_LOCAL_PART_LENGTH && lower.includes(local);
}
