import { NewPoolScreen } from '@webapp/components/pools/new-pool-screen';
import { getMyPools } from '@webapp/server/pool';

export const dynamic = 'force-dynamic';

export default async function NewPoolPage() {
  const { pools } = await getMyPools();
  return <NewPoolScreen first={pools.length === 0} />;
}
