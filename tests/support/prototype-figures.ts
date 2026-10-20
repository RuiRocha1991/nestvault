import { dec, toPlain, type Category, type CategoryKind, type LedgerData } from '@nestvault/domain';

import type { ApiWorld } from './api-world';

// The "overview numbers" of the NES-47 acceptance, as far as a fixture can show them: the same
// domain functions (account balances, month flows, portfolio value) read the prototype's data
// straight from the export file and the data the import wrote to the pool, and must agree. The
// prototype side is built from the raw JSON with its own, deliberately plain, conversion: it shares
// no code with the importer.

interface Row {
  [key: string]: unknown;
}
const rowsOf = (raw: Row, key: string): Row[] => (raw[key] as Row[] | undefined) ?? [];
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const str = (value: unknown): string =>
  typeof value === 'number' || typeof value === 'string' ? String(value) : '0';

/** The prototype's data as the domain's ledger: the movements whose account is in the file. */
export function fixtureLedger(raw: Row): LedgerData {
  const accounts = rowsOf(raw, 'accounts');
  const known = new Set(accounts.map((account) => text(account.id)));
  const kinds = new Map(
    rowsOf(raw, 'categories').map((category) => [text(category.id), text(category.kind)]),
  );
  return {
    accounts: accounts.map((account) => ({
      id: text(account.id),
      currency: text(account.ccy) || 'EUR',
      kind:
        account.type === 'prazo'
          ? ('term' as const)
          : account.type === 'remunerada'
            ? ('savings' as const)
            : ('other' as const),
      isBrokerage: account.type === 'corretora',
      trackCash: account.trackCash !== false,
      opening: str(account.opening),
      openingDate: text(account.openingDate) || null,
      // A term deposit is worth its deposit and moves money between the accounts it names.
      deposit:
        account.type === 'prazo'
          ? {
              id: text(account.id),
              capital: str(account.capital),
              rate: str(account.rate),
              start: text(account.start),
              payN: Number(account.payN) || null,
              payU: Number(account.payN) ? ('m' as const) : null,
              termN: Number(account.termN) || null,
              termU: Number(account.termN) ? ('m' as const) : null,
              capitalize: account.capitalize === true,
              tax: str(account.tax),
              payTo: text(account.payTo) || null,
              fundFrom: text(account.fundFrom) || null,
            }
          : null,
    })),
    transactions: rowsOf(raw, 'tx')
      .filter((tx) => known.has(text(tx.acc)))
      .map((tx) => ({
        id: text(tx.id),
        accountId: text(tx.acc),
        date: text(tx.date),
        amount: str(tx.amount),
        description: text(tx.desc),
        categoryId: text(tx.cat) || null,
        transfer: tx.transfer === true,
      })),
    interestEntries: rowsOf(raw, 'interest')
      .filter((entry) => known.has(text(entry.acc)) && Number(entry.amount) > 0)
      .map((entry) => ({
        id: text(entry.id),
        accountId: text(entry.acc),
        date: text(entry.date),
        amount: str(entry.amount),
      })),
    ops: [],
    assets: [],
    moves: [],
    categories: [...kinds].map(([id, kind]): Category => ({ id, kind: kind as CategoryKind })),
    rates: {},
    defaultTax: '28',
  };
}

/** The same ledger, read back from the pool through the services. */
export async function importedLedger(
  world: ApiWorld,
  headers: Headers,
  poolId: string,
): Promise<LedgerData> {
  const accounts = (await world.accounts.list(headers, poolId)).accounts;
  const transactions = [];
  for (let cursor: string | undefined; ;) {
    const page = await world.transactions.list(headers, poolId, {
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    transactions.push(...page.transactions);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const categories = (await world.categories.list(headers, poolId)).categories;
  const entries = (await world.interest.list(headers, poolId)).entries;
  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      currency: account.currency,
      kind:
        account.type === 'term_deposit'
          ? ('term' as const)
          : account.type === 'savings'
            ? ('savings' as const)
            : ('other' as const),
      isBrokerage: account.type === 'brokerage',
      trackCash: account.trackCash,
      opening: account.opening,
      openingDate: account.openingDate,
    })),
    transactions: transactions.map((tx) => ({
      id: tx.id,
      accountId: tx.accountId,
      date: tx.date,
      amount: tx.amount,
      description: tx.description,
      categoryId: tx.categoryId,
      transfer: tx.transfer,
    })),
    interestEntries: entries.map((entry) => ({
      id: entry.id,
      accountId: entry.accountId,
      date: entry.date,
      amount: entry.amount,
    })),
    ops: [],
    assets: [],
    moves: [],
    categories: categories.map((category): Category => ({ id: category.id, kind: category.kind })),
    rates: {},
    defaultTax: '28',
  };
}

/**
 * Value of the positions in EUR at the prototype's own prices and rates: units bought minus units
 * sold, times the current price, times the currency's rate. Plain arithmetic on the raw file.
 */
export function fixturePositionsValue(raw: Row): string {
  const rates = (raw.settings as { fx: Record<string, number> }).fx;
  const assets = new Map(rowsOf(raw, 'assets').map((asset) => [text(asset.id), asset]));
  const units = new Map<string, ReturnType<typeof dec>>();
  for (const op of rowsOf(raw, 'ops')) {
    const sign = op.type === 'buy' ? 1 : op.type === 'sell' ? -1 : 0;
    const asset = assets.get(text(op.asset));
    if (sign === 0 || !asset) continue;
    units.set(
      text(op.asset),
      (units.get(text(op.asset)) ?? dec(0)).plus(dec(str(op.qty)).times(sign)),
    );
  }
  let total = dec(0);
  for (const [id, quantity] of units) {
    const asset = assets.get(id);
    const price = dec(str(asset?.price || 0));
    const rate = text(asset?.ccy) === 'EUR' ? dec(1) : dec(String(rates[text(asset?.ccy)] ?? 1));
    total = total.plus(quantity.times(price).times(rate));
  }
  return toPlain(total);
}
