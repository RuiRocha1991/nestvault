import { z } from 'zod';

import { WARNING_CODES } from './schema';

const Count = z.number().int().min(0);

/** What an import creates, per entity (a dry run reports what a commit would create). */
export const ImportCountsDto = z.object({
  holders: Count,
  holdersMatched: Count,
  accounts: Count,
  subAccounts: Count,
  savingsProducts: Count,
  deposits: Count,
  categories: Count,
  categorySettings: Count,
  rules: Count,
  transactions: Count,
  transferPairs: Count,
  assets: Count,
  assetPrices: Count,
  portfolios: Count,
  plans: Count,
  investmentOps: Count,
  cashMoves: Count,
  interestEntries: Count,
  goalsSkipped: Count,
});
export type ImportCountsDto = z.infer<typeof ImportCountsDto>;

/** A thing the import changed or dropped on the way: a code and how many times, never the data. */
export const ImportWarningDto = z.object({ code: z.enum(WARNING_CODES), count: Count });
export type ImportWarningDto = z.infer<typeof ImportWarningDto>;

export const ImportResultDto = z.object({
  /** True for a dry run: nothing was written. */
  dryRun: z.boolean(),
  counts: ImportCountsDto,
  warnings: z.array(ImportWarningDto),
});
export type ImportResultDto = z.infer<typeof ImportResultDto>;
