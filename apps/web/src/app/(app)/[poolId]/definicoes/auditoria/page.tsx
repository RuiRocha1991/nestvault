import { AUDIT_ACTIONS, AUDIT_CATEGORIES } from '@nestvault/services';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AuditScreen } from '@webapp/components/audit/audit-screen';
import { SettingsHeader } from '@webapp/components/settings/settings-header';
import {
  AUDIT_PAGE_SIZE,
  auditQuery,
  parseAuditFilters,
  type SearchParams,
} from '@webapp/lib/audit-filters';
import { todayInLisbon } from '@webapp/lib/lisbon-date';
import { isPoolSegment } from '@webapp/lib/pool';
import { getAuditScreen } from '@webapp/server/audit';

export const dynamic = 'force-dynamic';

// Screens 76-78 and mobile-12. Owner only: the service answers 404 to a non-member and 403 to a
// member without `audit.read`, and both end in the 404 page. The filters live in the URL, so a
// reload or a shared link shows the same list. The page reads; it never changes an entry.
export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ poolId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();

  const today = todayInLisbon();
  const filters = parseAuditFilters(
    await searchParams,
    { actions: AUDIT_ACTIONS, categories: AUDIT_CATEGORIES },
    today,
  );
  const screen = await getAuditScreen(poolId, auditQuery(filters));
  const t = await getTranslations('audit');

  return (
    <>
      <SettingsHeader poolId={poolId} active="audit" lead={t('lead')} />
      <AuditScreen
        filters={filters}
        today={today}
        entries={screen.page.entries}
        total={screen.total}
        pageSize={AUDIT_PAGE_SIZE}
        people={Object.fromEntries(screen.people.map((person) => [person.id, person.name]))}
        members={screen.members}
        groups={AUDIT_CATEGORIES.map((category) => ({
          category,
          actions: AUDIT_ACTIONS.filter((action) => action.startsWith(`${category}.`)),
        }))}
      />
    </>
  );
}
