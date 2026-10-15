import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { PoolsTopbar } from '@webapp/components/pools/pools-topbar';
import { getCurrentSession } from '@webapp/server/session';

// Screens outside a pool (chooser, create): a minimal top bar and a centred column.
export default async function PoolsLayout({ children }: { children: ReactNode }) {
  // The (app) layout already redirected anonymous users; the session is cached for this request.
  const session = await getCurrentSession();
  if (!session) notFound();
  return (
    <div className="min-h-dvh bg-bg">
      <PoolsTopbar userName={session.name} />
      <main id="content" tabIndex={-1} className="mx-auto w-full px-6 pb-16 outline-none">
        {children}
      </main>
    </div>
  );
}
