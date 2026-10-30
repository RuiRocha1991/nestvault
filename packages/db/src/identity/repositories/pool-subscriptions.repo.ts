import { eq } from 'drizzle-orm';

import type { IdentityExecutor } from '../client';
import { poolSubscriptions, type PoolSubscriptionRow } from '../schema/pool-subscriptions';

export type { PoolSubscriptionRow };

export const poolSubscriptionsRepo = {
  /** The subscription of the pool; `undefined` means the pool is on Free. */
  async find(db: IdentityExecutor, poolId: string): Promise<PoolSubscriptionRow | undefined> {
    const [row] = await db
      .select()
      .from(poolSubscriptions)
      .where(eq(poolSubscriptions.poolId, poolId));
    return row;
  },
};
