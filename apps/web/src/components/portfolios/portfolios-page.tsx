import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PortfoliosScreen } from '@webapp/components/portfolios/portfolios-screen';
import { Topbar } from '@webapp/components/topbar';
import { todayInLisbon } from '@webapp/lib/lisbon-date';
import { isPoolSegment } from '@webapp/lib/pool';
import { parseCurrencyMode, parseGroup, parseTab } from '@webapp/lib/portfolios-view';
import { getAccountsScreen } from '@webapp/server/accounts-screen';
import { getHolders } from '@webapp/server/holders';
import { getPoolPermissions } from '@webapp/server/pool';
import {
  getAccounts,
  getAssets,
  getPlans,
  getPortfolios,
  linkedAccountRows,
  getPortfolioSummary,
  getPortfolioView,
} from '@webapp/server/portfolios';

export interface PortfoliosPageProps {
  poolId: string;
  /** The portfolio of the URL; undefined for "Todos". */
  portfolioId?: string;
  searchParams: { tab?: string | string[]; group?: string | string[]; moeda?: string | string[] };
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
  const mode = parseCurrencyMode(searchParams.moeda);
  const [t, permissions, { portfolios }] = await Promise.all([
    getTranslations(),
    getPoolPermissions(poolId),
    getPortfolios(poolId),
  ]);
  if (selected && !portfolios.some((p) => p.id === selected)) notFound();

  const [summary, data, { assets }, { accounts }, { plans }, { holders }, totals, screen] =
    await Promise.all([
      getPortfolioSummary(poolId, selected, mode),
      getPortfolioView(poolId, selected, mode),
      getAssets(poolId),
      getAccounts(poolId),
      getPlans(poolId),
      getHolders(poolId),
      // The value on each chip, in the portfolio's own currency like the prototype.
      Promise.all(portfolios.map((p) => getPortfolioSummary(poolId, p.id, 'portfolio'))),
      getAccountsScreen(poolId),
    ]);
  const allValue = (await getPortfolioSummary(poolId, '', 'base')).valueAll;

  // A portfolio without dividends has no Dividendos tab; its URL shows the Resumo instead.
  const requested = parseTab(searchParams.tab);
  const tab = requested === 'dividends' && !data.hasDividends ? 'summary' : requested;

  const chips = [
    {
      id: null,
      name: t('portfolios.all'),
      color: '',
      value: allValue,
      currency: data.display.baseCurrency,
    },
    ...portfolios.map((p, index) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      value: totals[index]?.valueAll ?? '0',
      currency: p.currency,
    })),
  ];

  return (
    <>
      <Topbar
        title={portfolios.find((p) => p.id === selected)?.name ?? t('nav.items.portfolios')}
      />
      <PortfoliosScreen
        ctx={{
          poolId,
          portfolioId: selected || null,
          portfolios,
          summary,
          data,
          currencyMode: mode,
          linkedAccounts: linkedAccountRows(screen.accounts, selected || null, data.display),
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
        tab={tab}
        group={parseGroup(searchParams.group)}
        today={todayInLisbon()}
      />
    </>
  );
}
