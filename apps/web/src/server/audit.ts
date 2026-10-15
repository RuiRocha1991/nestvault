import { ForbiddenError, NotFoundError } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { getAuditService } from './auth';

/**
 * One page of the pool's audit log. A non-member, an unknown pool and a member who is not the
 * owner all end in the same 404 page, so the screen's existence is not confirmed to them.
 */
export async function getAuditScreen(poolId: string, query: Record<string, string | number>) {
  try {
    return await (await getAuditService()).screen(await headers(), poolId, query);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
}
