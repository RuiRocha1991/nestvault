import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppFrame } from '@webapp/components/app-frame';
import { isPoolSegment } from '@webapp/lib/pool';
import { getMyPools, getPool } from '@webapp/server/pool';

export default async function PoolLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ poolId: string }>;
}) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  // Fetch pool and the user's pool list in parallel; the list drives the sidebar switcher.
  const [pool, { pools }] = await Promise.all([getPool(poolId), getMyPools()]);
  return (
    <AppFrame pool={pool} pools={pools}>
      {children}
    </AppFrame>
  );
}
