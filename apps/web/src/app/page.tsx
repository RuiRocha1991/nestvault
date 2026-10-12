import { redirect } from 'next/navigation';

// Placeholder until pools exist (NES-26): every screen lives under /[poolId].
const DEVELOPMENT_POOL = 'demo';

export default function Home() {
  redirect(`/${DEVELOPMENT_POOL}`);
}
