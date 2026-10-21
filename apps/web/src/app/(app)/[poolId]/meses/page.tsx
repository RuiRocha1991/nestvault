import { notFound, redirect } from 'next/navigation';

import { todayInLisbon } from '@webapp/lib/lisbon-date';
import { monthHref } from '@webapp/lib/month-view';
import { isPoolSegment } from '@webapp/lib/pool';

export const dynamic = 'force-dynamic';

// "Meses" in the menu opens the review of the current month; the month navigation does the rest.
export default async function MonthsPage({ params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  redirect(monthHref(poolId, todayInLisbon().slice(0, 7)));
}
