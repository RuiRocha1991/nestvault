import { Card, EmptyState } from '@nestvault/ui';
import { getTranslations } from 'next-intl/server';

import { Topbar } from '@webapp/components/topbar';

export default async function OverviewPage() {
  const t = await getTranslations();

  return (
    <>
      <Topbar title={t('nav.items.overview')} />
      <Card>
        <EmptyState title={t('overview.emptyTitle')} description={t('overview.emptyText')} />
      </Card>
    </>
  );
}
