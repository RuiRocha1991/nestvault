import { randomBytes } from 'node:crypto';

import { testEnv } from '@nestvault/config/node';
import {
  createIdentityDatabase,
  invitesRepo,
  newId,
  poolMembersRepo,
  poolsRepo,
  type Role,
} from '@nestvault/db';
import { seedOwner } from '@nestvault/services';

export const MEMBERS_PASSWORD = 'members-passphrase-for-e2e-only';

/** A name that would run script if it were ever rendered as markup. */
export const HOSTILE_NAME = '<script>window.__pwned=1</script>Carla';

export interface MembersPerson {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export interface MembersWorld {
  poolId: string;
  poolName: string;
  owner: MembersPerson;
  admin: MembersPerson;
  member: MembersPerson;
  viewer: MembersPerson;
  inviteEmail: string;
}

const unique = () => `${String(Date.now())}-${newId().slice(-6)}`;

/**
 * A pool of its own with an owner (Rui), an admin (Ana), a member (Beto), a viewer and one pending
 * invite, built straight in the `_test` database so each spec depends on nothing else.
 */
export async function seedMembersWorld(
  options: { viewerName?: string } = {},
): Promise<MembersWorld> {
  const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 1);
  try {
    const poolId = newId();
    const poolName = 'Família Membros';
    await poolsRepo.insert(identity.db, { id: poolId, name: poolName });
    const make = async (name: string, role: Role): Promise<MembersPerson> => {
      const email = `members-${role}-${unique()}@e2e.example.test`;
      const { userId } = await seedOwner(identity, { name, email, password: MEMBERS_PASSWORD });
      await poolMembersRepo.insert(identity.db, { poolId, userId, role });
      return { userId, name, email, role };
    };
    const owner = await make('Rui', 'owner');
    const admin = await make('Ana', 'admin');
    const member = await make('Beto', 'member');
    const viewer = await make(options.viewerName ?? 'Carla', 'viewer');

    const inviteEmail = `invitee-${unique()}@e2e.example.test`;
    await invitesRepo.upsertPending(identity.db, {
      id: newId(),
      poolId,
      email: inviteEmail,
      role: 'viewer',
      tokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      invitedBy: owner.userId,
    });
    return { poolId, poolName, owner, admin, member, viewer, inviteEmail };
  } finally {
    await identity.close();
  }
}
