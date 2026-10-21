import type { MonthReviewDto } from '@nestvault/services';

// The shapes the monthly review receives. Client components import these names from here, never
// the services root (a lint rule keeps server code out of the browser bundle).
export type MonthReview = MonthReviewDto;
export type MonthCategory = MonthReviewDto['categories'][number];
export type NotableTransaction = MonthReviewDto['notable'][number];
export type MonthOperationGroup = MonthReviewDto['operations'][number];
export type MonthOperation = MonthOperationGroup['operations'][number];
export type TimelineMonth = MonthReviewDto['timeline'][number];
export type MonthNote = MonthReviewDto['note'];

export interface CategoryOption {
  id: string;
  systemKey: string | null;
  name: string | null;
  color: string;
}

export interface MemberOption {
  id: string;
  name: string;
}
