import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AppShell } from '@webapp/components/shell';
import { Sidebar } from '@webapp/components/sidebar';
import { parseTheme, THEME_COOKIE } from '@webapp/lib/theme';
import { getCurrentSession } from '@webapp/server/session';

/** The sidebar and the content column shared by the pool pages and the account page. */
export async function AppFrame({ poolId, children }: { poolId: string; children: ReactNode }) {
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
