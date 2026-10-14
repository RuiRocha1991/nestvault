/** Message keys for the password errors the server answers with (400), shared by the forms. */
export const PASSWORD_PROBLEM_BY_CODE = {
  PASSWORD_BREACHED: 'breached',
  PASSWORD_TOO_COMMON: 'tooCommon',
  PASSWORD_BASED_ON_EMAIL: 'basedOnEmail',
  PASSWORD_TOO_SHORT: 'tooShort',
  PASSWORD_TOO_LONG: 'tooLong',
} as const;

export type PasswordProblem =
  (typeof PASSWORD_PROBLEM_BY_CODE)[keyof typeof PASSWORD_PROBLEM_BY_CODE];

/** The message key for a 400 answer's `code`, or null when the code is not a password error. */
export function passwordProblemOf(code: string | null): PasswordProblem | null {
  return code !== null && Object.hasOwn(PASSWORD_PROBLEM_BY_CODE, code)
    ? PASSWORD_PROBLEM_BY_CODE[code as keyof typeof PASSWORD_PROBLEM_BY_CODE]
    : null;
}

/** True when `value` is one of the password message keys (narrows a form state). */
export function isPasswordProblem(value: string): value is PasswordProblem {
  return (Object.values(PASSWORD_PROBLEM_BY_CODE) as string[]).includes(value);
}
