import { Card, EmptyState } from '@nestvault/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SettingsHeader } from '@webapp/components/settings/settings-header';
import { isPoolSegment } from '@webapp/lib/pool';

// Placeholder for "Agregado e parâmetros" until its task lands; it already carries the shared tabs.
export default async function SettingsPage({ params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  const t = await getTranslations('sections');

  return (
    <>
      <SettingsHeader poolId={poolId} active="params" />
      <Card>
        <EmptyState title={t('comingSoonTitle')} description={t('comingSoonText')} />
      </Card>
    </>
  );
}
