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

export interface PasswordRuleContext {
  /** The account's address, when known (sign-up body, the signed-in user, the reset token's user). */
  email?: string | undefined;
}

export interface PasswordRule {
  id: 'length' | 'common' | 'email';
  /** Error code of the 400 answer; the forms map it to a message. */
  code: 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_COMMON' | 'PASSWORD_BASED_ON_EMAIL';
  message: string;
  /** True when the password satisfies the rule. */
  passes(password: string, context: PasswordRuleContext): boolean;
}

/**
 * Every rule a password must meet, in the order they are checked. The server rejects with the
 * first one that fails; the form shows the same list as a checklist.
 */
export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: 'length',
    code: 'PASSWORD_TOO_SHORT',
    message: `The password must have at least ${String(PASSWORD_MIN_LENGTH)} characters.`,
    passes: (password) => password.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'common',
    code: 'PASSWORD_TOO_COMMON',
    message: 'This password is too common. Choose another one.',
    passes: (password) => !isCommonPassword(password),
  },
  {
    id: 'email',
    code: 'PASSWORD_BASED_ON_EMAIL',
    message: 'The password must not contain the email address.',
    passes: (password, { email }) => !isPasswordBasedOnEmail(password, email ?? ''),
  },
];

/** The first rule the password breaks, or null. A rule that needs the email passes without one. */
export function firstFailedPasswordRule(
  password: string,
  context: PasswordRuleContext = {},
): PasswordRule | null {
  return PASSWORD_RULES.find((rule) => !rule.passes(password, context)) ?? null;
}
