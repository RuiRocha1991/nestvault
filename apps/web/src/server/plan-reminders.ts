import { logger, NotFoundError } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { buildPlanReminders, type PlanReminderView } from '@webapp/lib/plan-reminders-view';

import {
  getAssetsService,
  getNotificationsService,
  getPlansService,
  getPortfoliosService,
} from './auth';

/**
 * Runs an extra read of a page. A pool the caller cannot see keeps ending in the 404 page, but
 * reminders are a nice-to-have: any other failure is logged (its type only, never a message or
 * data) and the page renders without them.
 */
async function orNothing<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    logger.warn(
      { errorType: error instanceof Error ? error.name : typeof error },
      'plan reminders unavailable',
    );
    return empty;
  }
}

const listNotifications = async (poolId: string) =>
  (await (await getNotificationsService()).list(await headers(), poolId, {})).notifications;

/** The open plan notifications of the pool with the caller's read state (once per page). */
export const getOpenNotifications = cache((poolId: string) =>
  orNothing(() => listNotifications(poolId), []),
);

/**
 * The reminders for a page that does not load plans, assets and portfolios itself (the overview).
 * A page that has them calls `getOpenNotifications` and `buildPlanReminders` with its own data.
 */
export const getPlanReminders = cache((poolId: string): Promise<PlanReminderView[]> =>
  orNothing(async () => {
    const h = await headers();
    const [notifications, { plans }, { assets }, { portfolios }] = await Promise.all([
      listNotifications(poolId),
      (await getPlansService()).list(h, poolId),
      (await getAssetsService()).list(h, poolId),
      (await getPortfoliosService()).list(h, poolId),
    ]);
    return buildPlanReminders(notifications, plans, assets, portfolios);
  }, []),
);
