import { sql } from 'drizzle-orm';

import { testEnv } from '@nestvault/config/node';
import { createIdentityDatabase, poolMembersRepo } from '@nestvault/db';
import { seedOwner } from '@nestvault/services';

import { E2E_POOL_ID } from './user';

/** Mailpit's web API (docker-compose publishes it on 127.0.0.1:8025). */
const MAILPIT = 'http://127.0.0.1:8025/api/v1';

interface Summary {
  ID: string;
  Subject: string;
}

export async function clearMailbox(address: string): Promise<void> {
  await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:${address}`)}`, {
    method: 'DELETE',
  });
}

/** Waits for a message to `address` and returns its subject and plain-text body. */
export async function waitForEmail(address: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:${address}`)}`);
    const { messages } = (await found.json()) as { messages?: Summary[] };
    const first = messages?.[0];
    if (first) {
      const message = await fetch(`${MAILPIT}/message/${first.ID}`);
      const { Text } = (await message.json()) as { Text: string };
      return { subject: first.Subject, text: Text };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('No email arrived in Mailpit');
}

/** The first link of a message that points at `page` (e.g. `recuperar`), as a path. */
export function linkPath(text: string, page: string): string {
  const match = new RegExp(`https?://[^/\\s]+(/${page}/[^\\s"<]+)`).exec(text);
  if (!match?.[1]) throw new Error(`No /${page}/ link in the email`);
  return match[1];
}

/**
 * A user of their own, so that a reset or a verification never touches the shared E2E owner. By
 * default a member of the E2E pool; `joinPool: false` gives a user without any pool.
 */
export async function createUser(input: {
  email: string;
  password: string;
  verified?: boolean;
  joinPool?: boolean;
}) {
  const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 1);
  try {
    const { userId } = await seedOwner(identity, {
      name: 'E2E Reset',
      email: input.email,
      password: input.password,
    });
    // A member of the E2E pool, so signing in lands there like it does for a one-pool user.
    if (input.joinPool !== false) {
      await poolMembersRepo.insert(identity.db, { poolId: E2E_POOL_ID, userId, role: 'member' });
    }
    if (input.verified === false) {
      await identity.db.execute(
        sql`update "user" set email_verified = false where email = ${input.email}`,
      );
    }
  } finally {
    await identity.close();
  }
}
