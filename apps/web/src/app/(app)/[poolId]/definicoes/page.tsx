import { nextHolderColor } from '@nestvault/services';
import { notFound } from 'next/navigation';

import { HoldersCard } from '@webapp/components/holders/holders-card';
import { HouseholdCard } from '@webapp/components/settings/household-card';
import { ImportPrototypeCard } from '@webapp/components/settings/import-prototype-card';
import { ParametersCard } from '@webapp/components/settings/parameters-card';
import { SettingsHeader } from '@webapp/components/settings/settings-header';
import { FX_CURRENCIES, type FxCurrency, type FxRateView } from '@webapp/lib/parameters-form';
import { isPoolSegment } from '@webapp/lib/pool';
import { getHolders } from '@webapp/server/holders';
import { getMembers } from '@webapp/server/members';
import { getPool, getPoolPermissions } from '@webapp/server/pool';
import { getFx, getSettings } from '@webapp/server/settings';

export const dynamic = 'force-dynamic';

// "Agregado e parâmetros": household data (NES-137) beside the pool parameters (NES-46), the
// household's people (NES-38) below.
// The tabs are shared with the other settings screens.
export default async function SettingsPage({ params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  const [permissions, { holders }, settings, fx, pool, { members }] = await Promise.all([
    getPoolPermissions(poolId),
    getHolders(poolId),
    getSettings(poolId),
    getFx(poolId),
    getPool(poolId),
    getMembers(poolId),
  ]);
  const rates = Object.fromEntries(
    FX_CURRENCIES.map((currency) => {
      const found = fx.rates.find((entry) => entry.currency === currency);
      return [
        currency,
        {
          rate: found?.rate ?? '1',
          marketRate: found?.marketRate ?? '1',
          source: found?.source ?? 'default',
          date: found?.date ?? null,
        },
      ];
    }),
  ) as Record<FxCurrency, FxRateView>;

  return (
    <>
      <SettingsHeader poolId={poolId} active="params" />
      {/* Two columns on desktop as in mockup 69; one column up to 860 px (the drawer breakpoint). */}
      <div
        data-testid="settings-grid"
        className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4 drawer:grid-cols-[minmax(0,1fr)]"
      >
        <HouseholdCard
          // A new key after a save makes the form start again from what the server now holds.
          key={JSON.stringify([pool.name, settings.displayCurrency])}
          poolId={poolId}
          name={pool.name}
          baseCurrency={settings.displayCurrency}
          createdAt={pool.createdAt}
          ownerName={members.find((member) => member.owner)?.name ?? ''}
          memberCount={pool.memberCount}
          holderCount={holders.length}
          canEdit={permissions.includes('pool.rename')}
        />
        <ParametersCard
          // A new key after a save makes the form start again from what the server now holds.
          key={JSON.stringify([settings, rates])}
          poolId={poolId}
          settings={settings}
          rates={rates}
          canWrite={permissions.includes('settings.write')}
        />
      </div>
      {/* The people of the household (NES-38) below, full width. */}
      <div className="mt-4">
        <HoldersCard
          poolId={poolId}
          holders={holders}
          suggestedColor={nextHolderColor(holders.map((holder) => holder.color))}
          transferDays={settings.transferWindowDays}
          canWrite={permissions.includes('accounts.write')}
        />
      </div>
      {/* Second row, full width as in mockup 69; outside the grid so it keeps its two cells. */}
      {permissions.includes('pool.import') && (
        <div className="mt-4">
          <ImportPrototypeCard poolId={poolId} />
        </div>
      )}
    </>
  );
}
