import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppFrame } from '@webapp/components/app-frame';
import { getMyPools } from '@webapp/server/pool';

// The account belongs to the user, not to a pool: no [poolId] here. The sidebar still shows the
// pool the session worked in last (or the first one), so the way back into the app is one click.
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const { pools, activePoolId } = await getMyPools();
  const currentId = activePoolId ?? pools[0]?.id;
  if (!currentId) redirect('/pools'); // no pool yet: create the first one
  const pool = pools.find((p) => p.id === currentId) ?? pools[0];
  if (!pool) redirect('/pools');
  return (
    <AppFrame pool={pool} pools={pools}>
      {children}
    </AppFrame>
  );
}
