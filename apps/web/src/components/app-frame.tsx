import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { PageHeaderProvider } from '@webapp/components/page-header-context';
import { AppShell } from '@webapp/components/shell';
import { Sidebar } from '@webapp/components/sidebar';
import type { PoolSummary } from '@webapp/lib/pool';
import { parseTheme, THEME_COOKIE } from '@webapp/lib/theme';
import { getHolders } from '@webapp/server/holders';
import { getMyPools, getPoolPermissions } from '@webapp/server/pool';
import { getPortfolios } from '@webapp/server/portfolios';
import { getCurrentSession } from '@webapp/server/session';

/** The sidebar and the content column shared by the pool pages and the account page. */
export async function AppFrame({
  pool,
  pools: poolsProp,
  children,
}: {
  pool: PoolSummary;
  /** Pass from the layout to avoid a second `getMyPools` call; falls back to fetching otherwise. */
  pools?: readonly PoolSummary[];
  children: ReactNode;
}) {
  const t = await getTranslations('shell');
  // The (app) layout already redirected anonymous users; the session is cached for this request.
  const session = await getCurrentSession();
  if (!session) notFound();
  const pools = poolsProp ?? (await getMyPools()).pools;
  // Read on every render of the layout, so `router.refresh()` after a portfolio is created,
  // renamed, recoloured or deleted updates the sidebar without a reload.
  const [{ portfolios }, { holders }, permissions] = await Promise.all([
    getPortfolios(pool.id),
    getHolders(pool.id),
    getPoolPermissions(pool.id),
  ]);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <AppShell
      scrimLabel={t('closeMenu')}
      skipLabel={t('skipToContent')}
      sidebar={
        // Explicit keys: elements built on the server and rendered as siblings inside the client
        // `AppShell` trigger React's dev-only "unique key" warning otherwise.
        <Sidebar
          key="sidebar"
          pool={pool}
          pools={pools}
          portfolios={portfolios.map(({ id, name, color }) => ({ id, name, color }))}
          theme={theme}
          userName={session.name}
        />
      }
    >
      <main key="content" id="content" tabIndex={-1} className="outline-none">
        <PageHeaderProvider
          value={{
            poolId: pool.id,
            holders: holders.map(({ id, name, color }) => ({ id, name, color })),
            canAddTransaction: permissions.includes('transactions.write'),
          }}
        >
          {children}
        </PageHeaderProvider>
      </main>
    </AppShell>
  );
}
