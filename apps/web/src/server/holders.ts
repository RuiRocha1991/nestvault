import { NotFoundError } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { getHoldersService } from './auth';

/** The people of the household (once per page). A non-member and an unknown pool end in the 404 page. */
export const getHolders = cache(async (poolId: string) => {
  try {
    return await (await getHoldersService()).list(await headers(), poolId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});
