import {
  NotFoundError,
  toDisplay,
  type AccountCardDto,
  type DisplayDto,
} from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import type { LinkedAccountRow } from '@webapp/lib/portfolios-types';

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
export const getPortfolioSummary = cache(
  (poolId: string, portfolioId: string, currency: 'portfolio' | 'base' = 'portfolio') =>
    asPoolMember(async () =>
      (await getPortfoliosService()).summary(await headers(), poolId, {
        ...(portfolioId ? { portfolioId } : {}),
        currency,
      }),
    ),
);

/** Positions, operations, dividends, performance and allocation of the same scope. */
export const getPortfolioView = cache(
  (poolId: string, portfolioId: string, currency: 'portfolio' | 'base' = 'portfolio') =>
    asPoolMember(async () =>
      (await getPortfoliosService()).view(await headers(), poolId, {
        ...(portfolioId ? { portfolioId } : {}),
        currency,
      }),
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

/**
 * The accounts linked to a portfolio (or to any, for "Todos") with what the table shows: balance
 * and interest in the account's own currency and in the currency of the portfolio figures.
 */
export function linkedAccountRows(
  cards: readonly AccountCardDto[],
  portfolioId: string | null,
  display: DisplayDto,
): LinkedAccountRow[] {
  return cards
    .filter((card) => (portfolioId ? card.portfolioId === portfolioId : card.portfolioId !== null))
    .map((card) => {
      // A term deposit is in EUR; its interest is the net interest of the deposit so far, and has
      // a 12-month figure only when it pays interest during the term (else the prototype shows a
      // dash).
      const total = card.term ? card.term.net : (card.interest?.total ?? '0');
      const last12 = card.term ? card.term.net12Months : (card.interest?.last12Months ?? '0');
      const convert = (amount: string) => toDisplay(amount, card.currency, display);
      return {
        id: card.id,
        name: card.name,
        institution: card.institution,
        type: card.type,
        currency: card.currency,
        groupName: card.groupName,
        holderIds: card.holderIds,
        rate: card.term?.rate ?? card.rate,
        since: card.term?.start ?? null,
        balance: card.balance,
        balanceDisplay: convert(card.balance),
        interest12: last12,
        interest12Display: last12 === null ? null : convert(last12),
        interestTotal: total,
        interestTotalDisplay: convert(total),
      };
    });
}
