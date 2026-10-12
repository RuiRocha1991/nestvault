import { Card, EmptyState } from '@nestvault/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SECTION_PAGES } from '@webapp/components/nav';
import { Topbar } from '@webapp/components/topbar';

// Placeholder for the screens that arrive in later tasks. Only known sections resolve.
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const navKey = Object.hasOwn(SECTION_PAGES, section) ? SECTION_PAGES[section] : undefined;
  if (!navKey) notFound();

  const t = await getTranslations();

  return (
    <>
      <Topbar title={t(`nav.items.${navKey}`)} />
      <Card>
        <EmptyState
          title={t('sections.comingSoonTitle')}
          description={t('sections.comingSoonText')}
        />
      </Card>
    </>
  );
}
