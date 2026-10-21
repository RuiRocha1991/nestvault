import { NotFoundError, type OverviewRange } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { getOverviewService } from './auth';

/** The overview of the pool (once per page): one service call, one round trip to the database. */
export const getOverview = cache(async (poolId: string, range: OverviewRange) => {
  try {
    return await (await getOverviewService()).get(await headers(), poolId, { range });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});
