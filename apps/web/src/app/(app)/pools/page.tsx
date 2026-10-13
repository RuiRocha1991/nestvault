import { redirect } from 'next/navigation';

// Placeholder until the pool chooser exists (NES-26): every screen lives under /[poolId].
const DEVELOPMENT_POOL = 'demo';

export default function PoolsPage() {
  redirect(`/${DEVELOPMENT_POOL}`);
}
