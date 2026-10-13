import { usersRepo, type IdentityDatabase } from '@nestvault/db';
import { z } from 'zod';

import { ValidationError } from '../errors';

import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './passwords';

const SeedOwnerInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

export type SeedOwnerInput = z.input<typeof SeedOwnerInput>;

/**
 * Creates the first user from the seed script. Idempotent: an existing email is left untouched
 * (its password is never overwritten). Pools and the owner membership arrive with NES-25.
 */
export async function seedOwner(
  identity: IdentityDatabase,
  input: SeedOwnerInput,
): Promise<{ userId: string; created: boolean }> {
  const parsed = SeedOwnerInput.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      'The seed owner is not valid.',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  const { name, email, password } = parsed.data;
  const existing = await usersRepo.findIdByEmail(identity.db, email);
  if (existing) return { userId: existing, created: false };
  const passwordHash = await hashPassword(password);
  const userId = await usersRepo.insertCredentialUser(identity.db, { name, email, passwordHash });
  return { userId, created: true };
}
