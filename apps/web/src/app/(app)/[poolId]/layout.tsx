import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppFrame } from '@webapp/components/app-frame';
import { isPoolSegment } from '@webapp/lib/pool';
import { getMyPools, getPool } from '@webapp/server/pool';

/** The tab title follows the pool's name (it changes after a rename, on the next refresh). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ poolId: string }>;
}): Promise<Metadata> {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) return {};
  return { title: (await getPool(poolId)).name };
}

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
