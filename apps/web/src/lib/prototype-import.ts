// What the "Importar do protótipo" card needs besides its markup (NES-47): the size limit the
// server also enforces, the order of the counts and how a failed answer maps to a message.

/** The file limit of the endpoint (10 MB); checked here first so a big file is refused without upload. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** The counts shown, in this order; zero ones are left out. Keys are `importPrototype.counts.*`. */
export const COUNT_KEYS = [
  'holders',
  'accounts',
  'subAccounts',
  'savingsProducts',
  'deposits',
  'categories',
  'rules',
  'transactions',
  'transferPairs',
  'portfolios',
  'assets',
  'assetPrices',
  'plans',
  'investmentOps',
  'cashMoves',
  'interestEntries',
  'goals',
] as const;
export type CountKey = (typeof COUNT_KEYS)[number];

export interface ImportAnswer {
  dryRun: boolean;
  counts: Record<string, number>;
  warnings: { code: string; count: number }[];
}

/** Narrows the JSON of a successful answer; anything else is treated as a failure. */
export function readAnswer(body: unknown): ImportAnswer | null {
  if (typeof body !== 'object' || body === null) return null;
  const { dryRun, counts, warnings } = body as Record<string, unknown>;
  if (typeof dryRun !== 'boolean' || typeof counts !== 'object' || counts === null) return null;
  if (!Array.isArray(warnings)) return null;
  return {
    dryRun,
    counts: counts as Record<string, number>,
    warnings: warnings as ImportAnswer['warnings'],
  };
}

/** The counts to list: the known keys with something to import, in display order. */
export function visibleCounts(counts: Record<string, number>): { key: CountKey; value: number }[] {
  return COUNT_KEYS.flatMap((key) => {
    const value = counts[key];
    return typeof value === 'number' && value > 0 ? [{ key, value }] : [];
  });
}

export type ImportProblem =
  'notJson' | 'tooLarge' | 'invalid' | 'forbidden' | 'notEmpty' | 'limit' | 'error';

/** The message key for a failed answer; 413 and 400 both mean "this file cannot be imported". */
export function problemOf(status: number): ImportProblem {
  if (status === 400) return 'invalid';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'notEmpty';
  if (status === 413) return 'tooLarge';
  if (status === 429) return 'limit';
  return 'error';
}

/** `goals_not_imported` → `goalsNotImported`, the message key of a warning code. */
export const warningKey = (code: string): string =>
  code.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
