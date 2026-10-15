import { sql } from 'drizzle-orm';

import { testEnv } from '@nestvault/config/node';
import {
  createIdentityDatabase,
  newId,
  poolMembersRepo,
  poolsRepo,
  type Role,
} from '@nestvault/db';
import { seedOwner } from '@nestvault/services';

export const AUDIT_PASSWORD = 'audit-passphrase-for-e2e-only';

/** A name that would run script if it were ever rendered as markup. */
export const HOSTILE_NAME = '<script>window.__pwned=1</script>Ana';

export interface AuditPerson {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export interface AuditWorld {
  poolId: string;
  owner: AuditPerson;
  admin: AuditPerson;
  member: AuditPerson;
  /** Entries newer than a week: 28 invites + 1 role change + 1 removal + 1 failed sign-in. */
  recentCount: number;
  /** Entries 60 days old, outside the default 30 day period. */
  oldCount: number;
}

const unique = () => `${String(Date.now())}-${newId().slice(-6)}`;

/**
 * A pool of its own with an owner, an admin and a member, and a log with enough entries for two
 * pages. Built straight in the `_test` database, so the specs never depend on one another.
 */
export async function seedAuditWorld(): Promise<AuditWorld> {
  const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 1);
  try {
    const poolId = newId();
    await poolsRepo.insert(identity.db, { id: poolId, name: 'Família Auditada' });
    const make = async (name: string, role: Role): Promise<AuditPerson> => {
      const email = `audit-${role}-${unique()}@e2e.example.test`;
      const { userId } = await seedOwner(identity, { name, email, password: AUDIT_PASSWORD });
      await poolMembersRepo.insert(identity.db, { poolId, userId, role });
      return { userId, name, email, role };
    };
    const owner = await make('Rui', 'owner');
    const admin = await make(HOSTILE_NAME, 'admin');
    const member = await make('Liliana', 'member');

    const insert = (
      minutesAgo: number,
      userId: string | null,
      action: string,
      target: string | null,
      meta: Record<string, string> = {},
    ) =>
      identity.db.execute(sql`
        insert into audit_log (id, pool_id, user_id, action, target, ip, at, meta)
        values (${newId()}, ${poolId}, ${userId}, ${action}, ${target}, '85.240.12.34',
          now() - make_interval(mins => ${minutesAgo}), ${JSON.stringify(meta)}::jsonb)`);

    for (let i = 0; i < 28; i += 1) {
      await insert(10 + i, owner.userId, 'invite.created', newId(), { role: 'viewer' });
    }
    await insert(40, owner.userId, 'member.role_changed', admin.userId, {
      previousRole: 'member',
      role: 'admin',
    });
    await insert(41, owner.userId, 'member.removed', member.userId, { role: 'member' });
    await insert(42, null, 'auth.signin_failed', null);
    const sixtyDays = 60 * 24 * 60;
    await insert(sixtyDays, owner.userId, 'pool.created', null);
    await insert(sixtyDays + 5, member.userId, 'invite.accepted', newId(), { role: 'member' });

    return { poolId, owner, admin, member, recentCount: 31, oldCount: 2 };
  } finally {
    await identity.close();
  }
}
