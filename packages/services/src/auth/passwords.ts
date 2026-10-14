import { hash, verify } from '@node-rs/argon2';

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password-policy';

// OWASP argon2id profile (19 MiB, 2 passes, 1 lane). Algorithm 2 is argon2id (the const enum
// `Algorithm` cannot be imported under verbatimModuleSyntax); the stored prefix is `$argon2id$`, which also carries the parameters, so they can be raised later without a migration.
const ARGON2_OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Better Auth's `password.hash`: argon2id instead of its scrypt default. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Better Auth's `password.verify`. A malformed stored hash is a failed login, not an error. */
export async function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  try {
    return await verify(input.hash, input.password);
  } catch {
    return false;
  }
}
