import { getOptionalSession } from '@nestvault/services';
import { headers } from 'next/headers';
import { cache } from 'react';

import { getAuth } from './auth';

/**
 * The session of the current request, or `null`. Read from the database on every request (no cookie
 * cache), once per request however many layouts and pages ask for it.
 */
export const getCurrentSession = cache(async () =>
  getOptionalSession(await getAuth(), await headers()),
);
