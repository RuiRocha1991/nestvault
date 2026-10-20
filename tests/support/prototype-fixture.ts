import { readFileSync } from 'node:fs';

import { GLOBAL_CATEGORIES } from '@nestvault/db';
import { PrototypeExport, type GlobalCategoryInfo } from '@nestvault/services';

// The anonymized export of the prototype used by the NES-47 tests (tests/fixtures). It is made up:
// invented people, round numbers and a few deliberately broken rows (an orphan movement, a pair
// with one side, an invalid IBAN, an operation of an unknown type…) so the warnings are exercised.
// A real export is never committed; importing the owner's own file is a manual check.

export const FIXTURE_PATH = new URL(
  '../fixtures/prototype-export.anonymized.json',
  import.meta.url,
);

/** The raw JSON, as the prototype wrote it. */
export const readFixtureJson = (): Record<string, unknown> =>
  JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;

/** The parsed export (the schema is strict, so this also proves the fixture is well formed). */
export const readFixture = (): PrototypeExport => PrototypeExport.parse(readFixtureJson());

/** The global catalogue as the mapper receives it from the database (ids made up). */
export const globalCategoryInfos = (): GlobalCategoryInfo[] =>
  GLOBAL_CATEGORIES.map((category, index) => ({
    id: `00000000-0000-7000-8000-${String(index + 1).padStart(12, '0')}`,
    systemKey: category.systemKey,
    kind: category.kind,
    color: category.color,
  }));

/** What importing the fixture into an empty pool creates (the same numbers as `docs`/the PR). */
export const FIXTURE_COUNTS = {
  holders: 3,
  holdersMatched: 0,
  accounts: 6,
  subAccounts: 2,
  savingsProducts: 1,
  deposits: 1,
  categories: 2,
  categorySettings: 4,
  rules: 5,
  transactions: 24,
  transferPairs: 2,
  assets: 4,
  assetPrices: 6,
  portfolios: 2,
  plans: 1,
  investmentOps: 9,
  cashMoves: 2,
  interestEntries: 2,
  goalsSkipped: 2,
} as const;

/** The warnings of the fixture, by code (how many times each happened). */
export const FIXTURE_WARNINGS: Record<string, number> = {
  goals_not_imported: 2,
  transaction_notes_dropped: 1,
  transaction_skipped: 1,
  category_reference_dropped: 1,
  pair_dropped: 1,
  rule_skipped: 3,
  iban_dropped: 1,
  sub_account_dropped: 1,
  account_reference_dropped: 1,
  interest_skipped: 1,
  asset_adjusted: 1,
  price_skipped: 1,
  op_skipped: 1,
  op_adjusted: 3,
  plan_skipped: 1,
  cash_move_skipped: 1,
};
