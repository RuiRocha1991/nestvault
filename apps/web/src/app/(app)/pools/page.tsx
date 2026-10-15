import { Plus } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { NewPoolScreen } from '@webapp/components/pools/new-pool-screen';
import { PoolCard } from '@webapp/components/pools/pool-card';
import { formatRelative } from '@webapp/lib/relative-time';
import { getMyPools } from '@webapp/server/pool';

export const dynamic = 'force-dynamic';

// Screens 62 and 63. Opening /pools goes straight to the pool when there is no choice to make: the
// only pool, or else the one the session worked in last. `?escolher=1` (the switcher) always shows
// the chooser. A user without a pool creates the first one here.
export default async function PoolsPage({
  searchParams,
}: {
  searchParams: Promise<{ escolher?: string }>;
}) {
  const [{ pools, activePoolId }, { escolher }] = await Promise.all([getMyPools(), searchParams]);

  if (pools.length === 0) return <NewPoolScreen first />;
  if (escolher === undefined) {
    const target = pools.length === 1 ? pools[0]?.id : activePoolId;
    if (target) redirect(`/${target}`);
  }

  const t = await getTranslations('pools');
  const now = new Date();
  return (
    <div className="mx-auto flex w-full max-w-[800px] flex-col gap-5 pt-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-[-0.01em]">{t('chooser.title')}</h1>
        <p className="text-md text-fg-3">{t('chooser.lead', { count: pools.length })}</p>
      </div>
      <ul className="grid list-none gap-4 p-0 sm:grid-cols-2">
        {pools.map((pool) => (
          <PoolCard
            key={pool.id}
            id={pool.id}
            name={pool.name}
            role={pool.role}
            memberCount={pool.memberCount}
            lastActivity={formatRelative(new Date(pool.lastActivityAt), now)}
          />
        ))}
        <li className="flex">
          <Link
            href="/pools/novo"
            className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-2 px-5 py-7 text-center no-underline hover:border-accent-2"
          >
            <span
              aria-hidden
              className="grid size-10 place-items-center rounded-md bg-accent-soft text-accent-2"
            >
              <Plus className="size-5" />
            </span>
            <b className="text-md text-fg">{t('chooser.create')}</b>
            <span className="text-md text-fg-2">{t('chooser.createText')}</span>
          </Link>
        </li>
      </ul>
      <p className="text-sm text-fg-3">{t('chooser.note')}</p>
    </div>
  );
}
