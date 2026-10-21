import { notFound } from 'next/navigation';

import { OverviewScreen } from '@webapp/components/overview/overview-screen';
import { parseRange } from '@webapp/lib/overview-view';
import { isPoolSegment } from '@webapp/lib/pool';
import { getHolders } from '@webapp/server/holders';
import { getOverview } from '@webapp/server/overview';
import { getPoolPermissions } from '@webapp/server/pool';

export const dynamic = 'force-dynamic';

// Visão geral (mockup 01-visao-geral). Everything comes from one overview service call; the
// permissions only hide the buttons a viewer cannot use (the services enforce them: 404 for
// non-members, 403 for a missing permission).
export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ poolId: string }>;
  searchParams: Promise<{ periodo?: string | string[] }>;
}) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  const range = parseRange((await searchParams).periodo);

  const [data, holders, permissions] = await Promise.all([
    getOverview(poolId, range),
    getHolders(poolId),
    getPoolPermissions(poolId),
  ]);

  return (
    <OverviewScreen
      poolId={poolId}
      data={data}
      holders={holders.holders.map(({ id, name, color }) => ({ id, name, color }))}
      can={{
        addTransaction: permissions.includes('transactions.write'),
        addPortfolio: permissions.includes('portfolios.write'),
        addAccount: permissions.includes('accounts.write'),
      }}
    />
  );
}
