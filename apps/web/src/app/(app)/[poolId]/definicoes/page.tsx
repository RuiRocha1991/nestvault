import { nextHolderColor } from '@nestvault/services';
import { Card, EmptyState } from '@nestvault/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { HoldersCard } from '@webapp/components/holders/holders-card';
import { SettingsHeader } from '@webapp/components/settings/settings-header';
import { isPoolSegment } from '@webapp/lib/pool';
import { getHolders } from '@webapp/server/holders';
import { getPoolPermissions } from '@webapp/server/pool';

export const dynamic = 'force-dynamic';

// Default of the pool's transfer window (3 days, PRD 04) until the pool settings arrive (NES-46).
const TRANSFER_DAYS = 3;

// "Agregado e parâmetros": the household's people (NES-38) above the parameters, which are a
// placeholder until their task lands. The tabs are shared with the other settings screens.
export default async function SettingsPage({ params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  const [t, permissions, { holders }] = await Promise.all([
    getTranslations('sections'),
    getPoolPermissions(poolId),
    getHolders(poolId),
  ]);

  return (
    <>
      <SettingsHeader poolId={poolId} active="params" />
      <div className="flex flex-col gap-4">
        <HoldersCard
          poolId={poolId}
          holders={holders}
          suggestedColor={nextHolderColor(holders.map((holder) => holder.color))}
          transferDays={TRANSFER_DAYS}
          canWrite={permissions.includes('accounts.write')}
        />
        <Card>
          <EmptyState title={t('comingSoonTitle')} description={t('comingSoonText')} />
        </Card>
      </div>
    </>
  );
}
