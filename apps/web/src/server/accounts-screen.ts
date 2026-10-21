import { NotFoundError } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { getAccountsService, getPortfoliosService, getProductsService } from './auth';

async function asPoolMember<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** The cards of "Contas e poupanças" (once per page). A non-member ends in the 404 page. */
export const getAccountsScreen = cache((poolId: string) =>
  asPoolMember(async () => (await getAccountsService()).screen(await headers(), poolId)),
);

/** The savings products of the pool with their deposits count and capital. */
export const getSavingsProducts = cache((poolId: string) =>
  asPoolMember(async () => (await getProductsService()).list(await headers(), poolId)),
);

/** The portfolios an account can be linked to. */
export const getPortfolioList = cache((poolId: string) =>
  asPoolMember(async () => (await getPortfoliosService()).list(await headers(), poolId)),
);
