import { ForbiddenError, NotFoundError } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { getInvitesService, getMembersService } from './auth';

/** The pool's members (once per page). A non-member and an unknown pool both end in the 404 page. */
export const getMembers = cache(async (poolId: string) => {
  try {
    return await (await getMembersService()).list(await headers(), poolId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});

/** The pending invites, for callers who may invite; anybody else gets an empty list. */
export const getPendingInvites = cache(async (poolId: string) => {
  try {
    return await (await getInvitesService()).listPending(await headers(), poolId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) return { invites: [] };
    throw error;
  }
});
