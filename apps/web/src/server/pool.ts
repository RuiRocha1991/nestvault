import { NotFoundError } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { getPoolsService } from './auth';

/** The pools of the current user and the one the session worked in last (once per request). */
export const getMyPools = cache(async () => (await getPoolsService()).listMine(await headers()));

/**
 * The pool of the URL, once the caller is known to be a member. A non-member, an unknown id and a
 * malformed one all end in the same 404 page; the (app) layout already sent anonymous users away.
 */
export const getPool = cache(async (poolId: string) => {
  try {
    return await (await getPoolsService()).open(await headers(), poolId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});
