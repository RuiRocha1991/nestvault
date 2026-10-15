import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { isPoolSegment } from '@webapp/lib/pool';
import { getPoolPermissions } from '@webapp/server/pool';

// Runs before the page streams its skeleton, so a person without `audit.read` gets a real 404
// status and not a 200 followed by a 404 body. The service still checks the permission on its own.
export default async function AuditLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ poolId: string }>;
}) {
  const { poolId } = await params;
  if (!isPoolSegment(poolId)) notFound();
  if (!(await getPoolPermissions(poolId)).includes('audit.read')) notFound();
  return children;
}
