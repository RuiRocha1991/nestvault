import { ROLE_PERMISSIONS } from '@nestvault/services';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { MembersScreen } from '@webapp/components/members/members-screen';
import { SettingsHeader } from '@webapp/components/settings/settings-header';
import type { RoleCapabilities, RoleName } from '@webapp/lib/members-view';
import { isPoolSegment } from '@webapp/lib/pool';
import { capabilitiesOf } from '@webapp/lib/role-capabilities';
import { getMembers, getPendingInvites } from '@webapp/server/members';
import { getPool, getPoolPermissions } from '@webapp/server/pool';

export const dynamic = 'force-dynamic';

// Screen 64. Any member sees who is in the pool and can leave it; owners and admins also see the
// emails, change roles, remove people and invite; only the owner sees the ownership card. The
// services enforce every one of those (404 for non-members, 403 for a missing permission): what is
// hidden here is cosmetic.
export default async function MembersPage({ params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();

  const [permissions, pool, list] = await Promise.all([
    getPoolPermissions(poolId),
    getPool(poolId),
    getMembers(poolId),
  ]);
  const canInvite = permissions.includes('members.invite');
  const [invites, t] = await Promise.all([
    canInvite ? getPendingInvites(poolId) : Promise.resolve({ invites: [] }),
    getTranslations('members'),
  ]);
  const capabilities = Object.fromEntries(
    Object.entries(ROLE_PERMISSIONS).map(([role, granted]) => [role, capabilitiesOf(granted)]),
  ) as Record<RoleName, ReturnType<typeof capabilitiesOf>> satisfies RoleCapabilities;

  return (
    <>
      <SettingsHeader poolId={poolId} active="members" lead={t('lead')} />
      <MembersScreen
        poolId={poolId}
        poolName={pool.name}
        now={new Date().toISOString()}
        members={list.members}
        invites={invites.invites}
        capabilities={capabilities}
        canManage={permissions.includes('members.manage')}
        canInvite={canInvite}
        canTransfer={permissions.includes('pool.transfer')}
      />
    </>
  );
}
