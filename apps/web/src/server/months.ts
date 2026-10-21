import { NotFoundError } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { getCategoriesService, getMonthsService } from './auth';

/** The monthly review of a month (once per page). A non-member ends in the 404 page. */
export const getMonthReview = cache(async (poolId: string, month: string) => {
  try {
    return await (await getMonthsService()).review(await headers(), poolId, month);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});

/** The pool's categories (names come from i18n for the global ones). */
export const getCategoryList = cache(async (poolId: string) => {
  try {
    return await (await getCategoriesService()).list(await headers(), poolId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});
