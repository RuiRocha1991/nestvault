import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { MonthReviewScreen } from '@webapp/components/months/month-review-screen';
import { Topbar } from '@webapp/components/topbar';
import { isMonthSegment } from '@webapp/lib/month-view';
import { isPoolSegment } from '@webapp/lib/pool';
import { getMembers } from '@webapp/server/members';
import { getMonthReview, getCategoryList } from '@webapp/server/months';
import { getPoolPermissions } from '@webapp/server/pool';

export const dynamic = 'force-dynamic';

// The monthly review (NES-54): the month's numbers, notable transactions and operations, the month
// note and a 12-month timeline. Reading needs `pool.read`; the notes need `notes.write` (the
// services check it again on every call). A bad month or a non-member ends in the 404 page.
export default async function MonthReviewPage({
  params,
}: {
  params: Promise<{ poolId: string; month: string }>;
}) {
  const { poolId, month } = await params;
  if (!isPoolSegment(poolId) || !isMonthSegment(month)) notFound();
  const [t, permissions, review, { categories }, { members }] = await Promise.all([
    getTranslations('months'),
    getPoolPermissions(poolId),
    getMonthReview(poolId, month),
    getCategoryList(poolId),
    getMembers(poolId),
  ]);

  return (
    <>
      <Topbar title={t('title')} />
      <MonthReviewScreen
        poolId={poolId}
        review={review}
        categories={categories.map((c) => ({
          id: c.id,
          systemKey: c.systemKey,
          name: c.name,
          color: c.color,
        }))}
        members={members.map((m) => ({ id: m.id, name: m.name }))}
        canWriteNotes={permissions.includes('notes.write')}
      />
    </>
  );
}
