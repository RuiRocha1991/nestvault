import { sql } from 'drizzle-orm';

import type { IdentityDatabase } from '@nestvault/db';

/** Sign-in needs a verified email: marks every user of the test database as verified. */
export async function verifyAllUsers(identity: IdentityDatabase): Promise<void> {
  await identity.db.execute(sql`update "user" set email_verified = true`);
}
