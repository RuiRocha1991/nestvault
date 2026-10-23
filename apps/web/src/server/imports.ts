import { NotFoundError } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { getImportsService } from './auth';

/**
 * The last committed imports of the pool, for the history of the import screen (once per request).
 * A non-member ends in the 404 page; `imports.run` is checked again by the service.
 */
export const getImportHistory = cache(async (poolId: string) => {
  try {
    return await (await getImportsService()).history(await headers(), poolId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});
