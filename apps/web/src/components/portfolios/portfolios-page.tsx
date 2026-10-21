import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PortfoliosScreen } from '@webapp/components/portfolios/portfolios-screen';
import { Topbar } from '@webapp/components/topbar';
import { todayInLisbon } from '@webapp/lib/lisbon-date';
import { isPoolSegment } from '@webapp/lib/pool';
import { parseGroup, parseTab } from '@webapp/lib/portfolios-view';
import { getHolders } from '@webapp/server/holders';
import { getPoolPermissions } from '@webapp/server/pool';
import {
  getAccounts,
  getAssets,
  getPlans,
  getPortfolios,
  getPortfolioSummary,
  getPortfolioView,
} from '@webapp/server/portfolios';

export interface PortfoliosPageProps {
  poolId: string;
  /** The portfolio of the URL; undefined for "Todos". */
  portfolioId?: string;
  searchParams: { tab?: string | string[]; group?: string | string[] };
}

/**
 * Loads what the Portfolios screen shows (all through the services, which check the session, the
 * membership and `pool.read`) and renders it. A bad id or a portfolio of another pool is a 404.
 */
export async function PortfoliosPage({ poolId, portfolioId, searchParams }: PortfoliosPageProps) {
  if (!isPoolSegment(poolId) || (portfolioId !== undefined && !isPoolSegment(portfolioId))) {
    notFound();
  }
  const selected = portfolioId?.toLowerCase() ?? '';
  const [t, permissions, { portfolios }] = await Promise.all([
    getTranslations(),
    getPoolPermissions(poolId),
    getPortfolios(poolId),
  ]);
  if (selected && !portfolios.some((p) => p.id === selected)) notFound();

  const [summary, data, { assets }, { accounts }, { plans }, { holders }, totals] =
    await Promise.all([
      getPortfolioSummary(poolId, selected),
      getPortfolioView(poolId, selected),
      getAssets(poolId),
      getAccounts(poolId),
      getPlans(poolId),
      getHolders(poolId),
      // The value shown on each chip: the summary of every portfolio (and of all of them).
      Promise.all(portfolios.map((p) => getPortfolioSummary(poolId, p.id))),
    ]);
  const allValue = selected ? (await getPortfolioSummary(poolId, '')).valueAll : summary.valueAll;

  const chips = [
    { id: null, name: t('portfolios.all'), color: '', value: allValue },
    ...portfolios.map((p, index) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      value: totals[index]?.valueAll ?? '0',
    })),
  ];

  return (
    <>
      <Topbar title={t('nav.items.portfolios')} />
      <PortfoliosScreen
        ctx={{
          poolId,
          portfolioId: selected || null,
          portfolios,
          summary,
          data,
          assets,
          assetsById: new Map(assets.map((asset) => [asset.id, asset])),
          accounts,
          plans,
          holders: holders.map((holder) => ({ id: holder.id, name: holder.name })),
          permissions: {
            ops: permissions.includes('ops.write'),
            portfolios: permissions.includes('portfolios.write'),
            notes: permissions.includes('notes.write'),
          },
        }}
        chips={chips}
        tab={parseTab(searchParams.tab)}
        group={parseGroup(searchParams.group)}
        today={todayInLisbon()}
      />
    </>
  );
}
