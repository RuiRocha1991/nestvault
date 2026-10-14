import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppFrame } from '@webapp/components/app-frame';
import { isPoolSegment } from '@webapp/lib/pool';

export default async function PoolLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ poolId: string }>;
}) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  return <AppFrame poolId={poolId}>{children}</AppFrame>;
}
