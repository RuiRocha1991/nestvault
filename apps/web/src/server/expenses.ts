import { NotFoundError, type TransactionPageDto } from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import {
  getAccountsService,
  getCategoriesService,
  getExpensesService,
  getRulesService,
  getTransactionsService,
} from './auth';

// What the Despesas screen reads, once per request. A non-member and an unknown pool end in the 404
// page; the services enforce the membership and the permissions, the page only chooses what to show.

async function asPoolMember<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export const getExpensesSummary = cache((poolId: string, month: string) =>
  asPoolMember(async () =>
    (await getExpensesService()).summary(await headers(), poolId, { month }),
  ),
);

export const getMovementTotals = cache((poolId: string, query: string) =>
  asPoolMember(async () =>
    (await getExpensesService()).totals(
      await headers(),
      poolId,
      Object.fromEntries(new URLSearchParams(query)),
    ),
  ),
);

export const getExpensesUsage = cache((poolId: string) =>
  asPoolMember(async () => (await getExpensesService()).usage(await headers(), poolId)),
);

/** The first page of the movements for a filter, as the API would answer it. */
export const getMovementsPage = cache(
  (poolId: string, query: string): Promise<TransactionPageDto> =>
    asPoolMember(async () =>
      (await getTransactionsService()).list(
        await headers(),
        poolId,
        Object.fromEntries(new URLSearchParams(query)),
      ),
    ),
);

export const getCategories = cache((poolId: string) =>
  asPoolMember(async () => (await getCategoriesService()).list(await headers(), poolId)),
);

export const getRules = cache((poolId: string) =>
  asPoolMember(async () => (await getRulesService()).list(await headers(), poolId)),
);

export const getAccounts = cache((poolId: string) =>
  asPoolMember(async () => (await getAccountsService()).list(await headers(), poolId)),
);
