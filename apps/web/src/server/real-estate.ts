import {
  NotFoundError,
  PlanLimitError,
  ValidationError,
  type CostListDto,
  type EventListDto,
  type InstallmentListDto,
  type LoanDto,
  type PropertyDto,
  type ReviewPreviewDto,
  type ScheduleDto,
  type WorkListDto,
} from '@nestvault/services';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import {
  getHoldersService,
  getLoansService,
  getPropertiesService,
  getPropertyCostsService,
  getWorksService,
} from './auth';

// What the Imobiliário screens read, once per request. A non-member, an unknown pool and an unknown
// property all end in the 404 page; a Free pool gets `locked` so the page can show the upgrade
// prompt (the services enforce the plan, `pool.read` and membership, the page only chooses).

export interface LoanBundle {
  loan: LoanDto;
  schedule: ScheduleDto;
  installments: InstallmentListDto['installments'];
  events: EventListDto['events'];
  /** `null` for a fixed-rate loan or before the first run of the index job. */
  review: ReviewPreviewDto | null;
}

async function asMember<T>(read: () => Promise<T>): Promise<T | 'locked'> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof PlanLimitError) return 'locked';
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
    throw error;
  }
}

async function bundleOf(poolId: string, loan: LoanDto): Promise<LoanBundle> {
  const loans = await getLoansService();
  const requestHeaders = await headers();
  const [schedule, installments, events, review] = await Promise.all([
    loans.schedule(requestHeaders, poolId, loan.id),
    loans.listInstallments(requestHeaders, poolId, loan.id),
    loans.listEvents(requestHeaders, poolId, loan.id),
    loans.reviewPreview(requestHeaders, poolId, loan.id).catch(() => null),
  ]);
  return {
    loan,
    schedule,
    installments: installments.installments,
    events: events.events,
    review,
  };
}

export interface HolderView {
  id: string;
  name: string;
  color: string;
}

const holdersOf = async (poolId: string): Promise<HolderView[]> => {
  const { holders } = await (await getHoldersService()).list(await headers(), poolId);
  return holders.map(({ id, name, color }) => ({ id, name, color }));
};

/** Every property of the pool with its loans, schedules and works (mockup 27). */
export const getRealEstate = cache((poolId: string) =>
  asMember(async () => {
    const requestHeaders = await headers();
    const [{ properties }, { loans }, works, holders] = await Promise.all([
      (await getPropertiesService()).list(requestHeaders, poolId),
      (await getLoansService()).list(requestHeaders, poolId),
      (await getWorksService()).list(requestHeaders, poolId),
      holdersOf(poolId),
    ]);
    const bundles = await Promise.all(loans.map((loan) => bundleOf(poolId, loan)));
    return { properties, bundles, works, holders };
  }),
);
export type RealEstateData = Exclude<Awaited<ReturnType<typeof getRealEstate>>, 'locked'>;

export interface PropertyPageData {
  property: PropertyDto;
  /** The loans of this property (the first one drives the schedule tabs). */
  bundles: LoanBundle[];
  works: WorkListDto;
  costs: CostListDto['costs'];
  holders: HolderView[];
}

/** One property with everything its tabs show (mockups 28 to 32). */
export const getPropertyPage = cache((poolId: string, propertyId: string) =>
  asMember(async (): Promise<PropertyPageData> => {
    const requestHeaders = await headers();
    const property = await (await getPropertiesService()).get(requestHeaders, poolId, propertyId);
    const [{ loans }, works, costs, holders] = await Promise.all([
      (await getLoansService()).list(requestHeaders, poolId),
      (await getWorksService()).list(requestHeaders, poolId, propertyId),
      (await getPropertyCostsService()).list(requestHeaders, poolId, propertyId),
      holdersOf(poolId),
    ]);
    const own = loans
      .filter((loan) => loan.propertyId === propertyId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    return {
      property,
      bundles: await Promise.all(own.map((loan) => bundleOf(poolId, loan))),
      works,
      costs: costs.costs,
      holders,
    };
  }),
);

/**
 * The sidebar entry: the properties under "Imobiliário" on a Pro pool, only the PRO tag on a Free
 * one. Never throws for the plan, so the rest of the app keeps working.
 */
export const getSidebarProperties = cache(
  async (
    poolId: string,
  ): Promise<{ locked: boolean; properties: { id: string; name: string }[] }> => {
    const found = await asMember(
      async () => (await (await getPropertiesService()).list(await headers(), poolId)).properties,
    );
    if (found === 'locked') return { locked: true, properties: [] };
    return { locked: false, properties: found.map(({ id, name }) => ({ id, name })) };
  },
);
