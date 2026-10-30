import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PropertyScreen } from '@webapp/components/real-estate/property-screen';
import { UpgradePrompt } from '@webapp/components/real-estate/upgrade-prompt';
import { Topbar } from '@webapp/components/topbar';
import { todayInLisbon } from '@webapp/lib/lisbon-date';
import { isPoolSegment } from '@webapp/lib/pool';
import { getPropertyPage } from '@webapp/server/real-estate';

export const dynamic = 'force-dynamic';

// One property (mockups 28 to 32). A property of another pool, or an unknown id, is a 404.
export default async function PropertyPage({
  params,
}: {
  params: Promise<{ poolId: string; propertyId: string }>;
}) {
  const { poolId, propertyId } = await params;
  if (!isPoolSegment(poolId) || !isPoolSegment(propertyId)) notFound();
  const [t, data] = await Promise.all([
    getTranslations('nav.items'),
    getPropertyPage(poolId, propertyId),
  ]);
  if (data === 'locked') {
    return (
      <>
        <Topbar title={t('realEstate')} />
        <UpgradePrompt />
      </>
    );
  }
  return (
    <>
      <Topbar title={data.property.name} />
      <PropertyScreen poolId={poolId} data={data} today={todayInLisbon()} />
    </>
  );
}
