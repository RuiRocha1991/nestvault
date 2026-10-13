import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AppShell } from '@webapp/components/shell';
import { Sidebar } from '@webapp/components/sidebar';
import { isPoolSegment } from '@webapp/lib/pool';
import { parseTheme, THEME_COOKIE } from '@webapp/lib/theme';
import { getCurrentSession } from '@webapp/server/session';

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
  // The (app) layout already redirected anonymous users; the session is cached for this request.
  const session = await getCurrentSession();
  if (!session) notFound();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <AppShell
      scrimLabel={t('closeMenu')}
      skipLabel={t('skipToContent')}
      sidebar={<Sidebar poolId={poolId} portfolios={[]} theme={theme} userName={session.name} />}
    >
      <main id="content" tabIndex={-1} className="outline-none">
        {children}
      </main>
    </AppShell>
  );
}
