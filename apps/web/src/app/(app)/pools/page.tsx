import { redirect } from 'next/navigation';

import { DEVELOPMENT_POOL } from '@webapp/lib/pool';

// Placeholder until the pool chooser exists (NES-26): every screen lives under /[poolId].

export default function PoolsPage() {
  redirect(`/${DEVELOPMENT_POOL}`);
}
