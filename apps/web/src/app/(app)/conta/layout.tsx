import type { ReactNode } from 'react';

import { AppFrame } from '@webapp/components/app-frame';
import { DEVELOPMENT_POOL } from '@webapp/lib/pool';

// The account belongs to the user, not to a pool: no [poolId] here. The sidebar still needs one to
// link to, until the pool chooser exists (NES-26).
export default function AccountLayout({ children }: { children: ReactNode }) {
  return <AppFrame poolId={DEVELOPMENT_POOL}>{children}</AppFrame>;
}
