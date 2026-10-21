import { NotFoundError } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import {
  getAccountsService,
  getAssetsService,
  getPlansService,
  getPortfoliosService,
} from './auth';

/** A non-member, an unknown pool and an unknown portfolio all end in the same 404 page. */
async function asPoolMember<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** The pool's portfolios (once per page). */
export const getPortfolios = cache((poolId: string) =>
  asPoolMember(async () => (await getPortfoliosService()).list(await headers(), poolId)),
);

/** The summary of one portfolio (or all of them when `portfolioId` is empty). */
export const getPortfolioSummary = cache((poolId: string, portfolioId: string) =>
  asPoolMember(async () =>
    (await getPortfoliosService()).summary(
      await headers(),
      poolId,
      portfolioId ? { portfolioId } : {},
    ),
  ),
);

/** Positions, operations, dividends, performance and allocation of the same scope. */
export const getPortfolioView = cache((poolId: string, portfolioId: string) =>
  asPoolMember(async () =>
    (await getPortfoliosService()).view(
      await headers(),
      poolId,
      portfolioId ? { portfolioId } : {},
    ),
  ),
);

/** The pool's assets with their latest price (once per page). */
export const getAssets = cache((poolId: string) =>
  asPoolMember(async () => (await getAssetsService()).list(await headers(), poolId)),
);

/** The pool's bank and brokerage accounts (once per page). */
export const getAccounts = cache((poolId: string) =>
  asPoolMember(async () => (await getAccountsService()).list(await headers(), poolId)),
);

/** The regular investment plans of the pool (once per page). */
export const getPlans = cache((poolId: string) =>
  asPoolMember(async () => (await getPlansService()).list(await headers(), poolId)),
);
