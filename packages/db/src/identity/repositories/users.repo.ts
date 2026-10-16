import { and, eq, inArray } from 'drizzle-orm';

import { newId } from '../../ids';
import type { IdentityDatabase } from '../client';
import { account, user } from '../schema';

export interface NewCredentialUser {
  name: string;
  email: string;
  /** Already hashed (argon2id); a plaintext password never reaches a repository. */
  passwordHash: string;
}

/** Repositories of `nestvault_identity`. No pool context here: identity is not pool data. */
export const usersRepo = {
  /** The user id for an email (case-insensitive: the column is `citext`), or undefined. */
  async findIdByEmail(db: IdentityDatabase['db'], email: string): Promise<string | undefined> {
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    return row?.id;
  },

  /** Display names for a set of user ids; ids with no user are simply absent. Ids are bound. */
  async namesByIds(
    db: IdentityDatabase['db'],
    ids: readonly string[],
  ): Promise<{ id: string; name: string }[]> {
    if (ids.length === 0) return [];
    return db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, [...ids]));
  },

  /** The argon2id hash of the user's password login, or `null` for an account without one. */
  async passwordHashOf(db: IdentityDatabase['db'], userId: string): Promise<string | null> {
    const [row] = await db
      .select({ password: account.password })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
      .limit(1);
    return row?.password ?? null;
  },

  /** Marks the address as verified (the person proved they read it, e.g. through a reset link). */
  async markEmailVerified(db: IdentityDatabase['db'], userId: string): Promise<void> {
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
  },

  /** Creates a verified user with an email + password login, atomically. Returns the user id. */
  async insertCredentialUser(db: IdentityDatabase['db'], data: NewCredentialUser): Promise<string> {
    const id = newId();
    await db.transaction(async (tx) => {
      await tx.insert(user).values({
        id,
        name: data.name,
        email: data.email,
        emailVerified: true,
      });
      await tx.insert(account).values({
        id: newId(),
        userId: id,
        accountId: id,
        providerId: 'credential',
        password: data.passwordHash,
      });
    });
    return id;
  },
};
