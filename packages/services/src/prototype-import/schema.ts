import { z } from 'zod';

// The file the prototype's "Exportar cópia (JSON)" writes (docs/prototype/cofre-familiar-v28.html,
// `exportData` / `migrate` / `emptyState`), as a zod schema. It is strict at every level: a field
// this list does not know is a 400 that names it, so a file from some other program (or a newer
// prototype) is refused instead of half imported. Everything is optional except the ids, because
// `migrate` fills in the defaults of older versions (see `migrate.ts`). Numbers may also arrive as
// text (a form field saved as typed), so numeric fields take both.

/** Largest request body the import accepts (the file, plus a few bytes of envelope). */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
/** The export nests five levels at most (state → list → entity → prices → price). */
export const IMPORT_MAX_DEPTH = 8;

export const ROWS_MAX = {
  members: 50,
  accounts: 500,
  categories: 500,
  rules: 5000,
  tx: 250_000,
  assets: 2000,
  ops: 100_000,
  plans: 500,
  portfolios: 100,
  interest: 50_000,
  goals: 500,
  pfMoves: 20_000,
  products: 200,
  prices: 50_000,
  subs: 50,
} as const;

const Id = z.string().min(1).max(64);
/** Optional reference to another entity; the empty text means "none" in the prototype. */
const Ref = z.string().max(160).nullish();
const Text = z.string().max(5000).nullish();
const Num = z.union([z.number(), z.string().max(40)]).nullish();
const Flag = z.boolean().nullish();

const entity = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const Member = entity({
  id: Id,
  name: Text,
  color: Text,
  // The prototype keeps the aliases as one comma separated text.
  aliases: z.union([z.string().max(2000), z.array(z.string().max(200)).max(50)]).nullish(),
});

const Sub = entity({ id: Id, name: Text, member: Ref });

const Account = entity({
  id: Id,
  name: Text,
  type: Text,
  bank: Text,
  // `members` replaced `member` in v2; both can be present.
  members: z.array(z.string().max(64)).max(ROWS_MAX.members).nullish(),
  member: Ref,
  opening: Num,
  openingDate: Text,
  rate: Num,
  ccy: Text,
  iban: Text,
  subs: z.array(Sub).max(ROWS_MAX.subs).nullish(),
  group: Text,
  pf: Ref,
  trackCash: Flag,
  xtb: Text,
  // Term deposits.
  product: Ref,
  capital: Num,
  start: Text,
  termMonths: Num,
  termN: Num,
  termU: Text,
  payN: Num,
  payU: Text,
  payTo: Ref,
  fundFrom: Ref,
  tax: Num,
  capitalize: Flag,
});

const Category = entity({ id: Id, name: Text, kind: Text, color: Text, budget: Num });

const Rule = entity({ id: Id, kw: Text, cat: Ref, acc: Ref });

const Tx = entity({
  id: Id,
  acc: Ref,
  date: Text,
  desc: Text,
  amount: Num,
  cat: Ref,
  manualCat: Flag,
  transfer: Flag,
  tlock: Flag,
  pair: Ref,
  // The prototype's 32-bit hash is thrown away: it is recomputed with SHA-256.
  hash: Text,
  depLink: Text,
  ext: Text,
  note: Text,
});

const Price = entity({ d: Text, p: Num });

const Asset = entity({
  id: Id,
  ticker: Text,
  symbol: Text,
  name: Text,
  type: Text,
  ccy: Text,
  price: Num,
  priceDate: Text,
  prices: z.array(Price).max(ROWS_MAX.prices).nullish(),
  sector: Text,
  country: Text,
  dps: Num,
  divMonths: z.array(Num).max(24).nullish(),
});

const Op = entity({
  id: Id,
  asset: Ref,
  pf: Ref,
  type: Text,
  date: Text,
  qty: Num,
  price: Num,
  fee: Num,
  cash: Ref,
  sub: Ref,
  fromCash: Flag,
  plan: Ref,
  amount: Num,
  gross: Num,
  tax: Num,
  ext: Text,
});

const Plan = entity({
  id: Id,
  asset: Ref,
  pf: Ref,
  amount: Num,
  day: Num,
  cash: Ref,
  sub: Ref,
  active: Flag,
});

const Portfolio = entity({
  id: Id,
  name: Text,
  color: Text,
  ccy: Text,
  note: Text,
  targets: z.record(z.string().max(64), Num).nullish(),
});

const Interest = entity({
  id: Id,
  acc: Ref,
  date: Text,
  amount: Num,
  rate: Num,
  ext: Text,
  note: Text,
});

// Goals are read (so a file that has them is accepted) but not imported: there is no goals table
// yet. Their fields are listed only so that the strict check does not refuse the file.
const Goal = entity({
  id: Id,
  name: Text,
  type: Text,
  target: Num,
  deadline: Text,
  when: Text,
  pfs: z.array(z.string().max(64)).max(ROWS_MAX.portfolios).nullish(),
  accs: z
    .array(z.string().max(130))
    .max(ROWS_MAX.accounts * 2)
    .nullish(),
  rate: Num,
  monthly: Num,
  yield: Num,
  color: Text,
  savings: Flag,
});

const PfMove = entity({
  id: Id,
  pf: Ref,
  date: Text,
  amount: Num,
  acc: Ref,
  note: Text,
  txId: Ref,
});

const Product = entity({
  id: Id,
  name: Text,
  bank: Text,
  rate: Num,
  payN: Num,
  payU: Text,
  termN: Num,
  termU: Text,
  payTo: Ref,
  fundFrom: Ref,
  tax: Num,
});

const Settings = entity({
  fx: z.record(z.string().max(8), Num).nullish(),
  tax: Num,
  tdays: Num,
  divTax: Num,
});

/** The export, as the prototype writes it. */
export const PrototypeExport = entity({
  v: z.number().int().min(1).max(6).nullish(),
  demo: Flag,
  exportedAt: Text,
  // Set by `migrate` while it upgrades a v<4 file and kept in the saved state.
  __reclass: Flag,
  members: z.array(Member).max(ROWS_MAX.members).nullish(),
  accounts: z.array(Account).max(ROWS_MAX.accounts).nullish(),
  categories: z.array(Category).max(ROWS_MAX.categories).nullish(),
  rules: z.array(Rule).max(ROWS_MAX.rules).nullish(),
  tx: z.array(Tx).max(ROWS_MAX.tx).nullish(),
  assets: z.array(Asset).max(ROWS_MAX.assets).nullish(),
  ops: z.array(Op).max(ROWS_MAX.ops).nullish(),
  plans: z.array(Plan).max(ROWS_MAX.plans).nullish(),
  portfolios: z.array(Portfolio).max(ROWS_MAX.portfolios).nullish(),
  interest: z.array(Interest).max(ROWS_MAX.interest).nullish(),
  goals: z.array(Goal).max(ROWS_MAX.goals).nullish(),
  pfMoves: z.array(PfMove).max(ROWS_MAX.pfMoves).nullish(),
  products: z.array(Product).max(ROWS_MAX.products).nullish(),
  settings: Settings.nullish(),
});
export type PrototypeExport = z.infer<typeof PrototypeExport>;

/** The request: `dryRun: true` only counts, `false` writes. Strict, like every input. */
export const ImportPrototypeInput = z
  .object({
    dryRun: z.boolean(),
    export: PrototypeExport,
  })
  .strict();
export type ImportPrototypeInput = z.input<typeof ImportPrototypeInput>;

/** How deep a parsed JSON value goes (iterative: a hostile file cannot overflow the stack). */
export function jsonDepth(value: unknown): number {
  let deepest = 0;
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 1 }];
  for (let item = stack.pop(); item; item = stack.pop()) {
    const { node, depth } = item;
    if (typeof node !== 'object' || node === null) continue;
    deepest = Math.max(deepest, depth);
    if (deepest > 64) return deepest;
    for (const child of Object.values(node)) stack.push({ node: child, depth: depth + 1 });
  }
  return deepest;
}

export const WARNING_CODES = [
  'goals_not_imported',
  'holder_matched',
  'transaction_notes_dropped',
  'transaction_skipped',
  'category_reference_dropped',
  'pair_dropped',
  'rule_skipped',
  'iban_dropped',
  'sub_account_dropped',
  'deposit_skipped',
  'product_skipped',
  'account_reference_dropped',
  'interest_skipped',
  'asset_adjusted',
  'price_skipped',
  'op_skipped',
  'op_adjusted',
  'plan_skipped',
  'cash_move_skipped',
  'duplicate_skipped',
  'fx_skipped',
  'default_rules_added',
  'account_owner_defaulted',
  'category_merged',
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];
