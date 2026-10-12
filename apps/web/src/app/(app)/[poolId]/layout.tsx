import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AppShell } from '../../../components/shell';
import { Sidebar } from '../../../components/sidebar';
import { isPoolSegment } from '../../../lib/pool';
import { parseTheme, THEME_COOKIE } from '../../../lib/theme';

export default async function PoolLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ poolId: string }>;
}) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  const t = await getTranslations('shell');
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <AppShell
      scrimLabel={t('closeMenu')}
      skipLabel={t('skipToContent')}
      sidebar={<Sidebar poolId={poolId} portfolios={[]} theme={theme} />}
    >
      <main id="content" tabIndex={-1} className="outline-none">
        {children}
      </main>
    </AppShell>
  );
}
