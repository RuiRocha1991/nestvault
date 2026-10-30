import { dec, sum } from '@nestvault/domain';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { GoalsScreen } from '@webapp/components/goals/goals-screen';
import { Topbar } from '@webapp/components/topbar';
import { monthAfter } from '@webapp/lib/goals-view';
import { todayInLisbon } from '@webapp/lib/lisbon-date';
import { isPoolSegment } from '@webapp/lib/pool';
import { getGoals } from '@webapp/server/goals';
import { getPoolPermissions } from '@webapp/server/pool';
import { getAccounts, getPlans, getPortfolios } from '@webapp/server/portfolios';

export const dynamic = 'force-dynamic';

const DEADLINE_YEARS = 10;

// Objetivos (mockups 09 and modal 20, mobile-05): goals with their projection. The page only
// chooses what to show: the services answer 404 to non-members and 403 to missing permissions.
export default async function GoalsPage({ params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  const [t, permissions, { goals, asOf }, { portfolios }, { accounts }, { plans }] =
    await Promise.all([
      getTranslations('nav.items'),
      getPoolPermissions(poolId),
      getGoals(poolId),
      getPortfolios(poolId),
      getAccounts(poolId),
      getPlans(poolId),
    ]);
  const today = todayInLisbon();
  const deadline = `${monthAfter(today, DEADLINE_YEARS * 12)}-${today.slice(8)}`;
  return (
    <>
      <Topbar title={t('goals')} />
      <GoalsScreen
        poolId={poolId}
        asOf={asOf}
        goals={goals}
        scope={{
          portfolios: portfolios.map((p) => ({ id: p.id, name: p.name })),
          accounts: accounts.map((a) => ({
            id: a.id,
            name: a.name,
            subAccounts: a.subAccounts.map((s) => ({ id: s.id, name: s.name })),
          })),
        }}
        defaultMonthly={sum(plans.filter((p) => p.active).map((p) => dec(p.amount))).toString()}
        defaultDeadline={deadline}
        canWrite={permissions.includes('goals.write')}
      />
    </>
  );
}
