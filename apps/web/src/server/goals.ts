import { NotFoundError } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { getGoalsService } from './auth';

// What the Objetivos screen reads, once per request. A non-member and an unknown pool end in the 404
// page; the service enforces the membership and `pool.read`, the page only chooses what to show.

/** The pool's goals with their calculation of today. */
export const getGoals = cache(async (poolId: string) => {
  try {
    return await (await getGoalsService()).list(await headers(), poolId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});
