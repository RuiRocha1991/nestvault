import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PropertyList } from '@webapp/components/real-estate/property-list';
import { UpgradePrompt } from '@webapp/components/real-estate/upgrade-prompt';
import { Topbar } from '@webapp/components/topbar';
import { isPoolSegment } from '@webapp/lib/pool';
import { getRealEstate } from '@webapp/server/real-estate';

export const dynamic = 'force-dynamic';

// Imobiliário (mockup 27): the pool's properties and loans. Pro only: a Free pool sees the upgrade
// prompt. The services answer 404 to non-members and enforce the plan and `pool.read`.
export default async function RealEstatePage({ params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  const [t, data] = await Promise.all([getTranslations('nav.items'), getRealEstate(poolId)]);
  return (
    <>
      <Topbar title={t('realEstate')} />
      {data === 'locked' ? <UpgradePrompt /> : <PropertyList poolId={poolId} data={data} />}
    </>
  );
}
