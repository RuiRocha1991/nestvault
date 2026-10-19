import { NotFoundError } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { getSettingsService } from './auth';

async function asPoolMember<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** The pool's settings (once per page). A non-member and an unknown pool end in the 404 page. */
export const getSettings = cache((poolId: string) =>
  asPoolMember(async () => (await getSettingsService()).get(await headers(), poolId)),
);

/** The FX rates the pool uses today (once per page). */
export const getFx = cache((poolId: string) =>
  asPoolMember(async () => (await getSettingsService()).fx(await headers(), poolId)),
);
