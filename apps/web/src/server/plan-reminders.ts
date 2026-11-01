import { NotFoundError } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { buildPlanReminders } from '@webapp/lib/plan-reminders-view';

import { getAssetsService, getNotificationsService, getPlansService } from './auth';

/**
 * The open plan reminders of the pool with the caller's read state (once per page). Every read goes
 * through a service, which checks the session, the membership and `pool.read`.
 */
export const getPlanReminders = cache(async (poolId: string) => {
  try {
    const h = await headers();
    const [{ notifications }, { plans }, { assets }] = await Promise.all([
      (await getNotificationsService()).list(h, poolId, {}),
      (await getPlansService()).list(h, poolId),
      (await getAssetsService()).list(h, poolId),
    ]);
    return buildPlanReminders(
      notifications,
      plans,
      new Map(assets.map((asset) => [asset.id, asset.ticker])),
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});
