import { dec, normalizeText, roundTo, toPlain, transactionHash } from '@nestvault/domain';

import type { ParserResponse } from './parser-client';

// What a parsed file becomes in the ledger, worked out without touching the database: the bank
// lines with their de-duplication hash, and the broker lines as the operations they stand for.
// Preview and commit both use it, so what the user confirmed is what is written.

export type ParsedRow = ParserResponse['rows'][number];
export type BankParsed = Extract<ParsedRow, { kind: 'bank' }>;
export type BrokerParsed = Extract<ParsedRow, { kind: 'broker' }>;

/** numeric(18,4): up to 14 digits and 4 decimals. A line the ledger cannot hold is skipped. */
const LEDGER_AMOUNT = /^-?\d{1,14}(\.\d{1,4})?$/;

export interface PlannedTransaction {
  /** Position of the line in the file. */
  index: number;
  date: string;
  description: string;
  /** Plain decimal text, the way the ledger stores it. */
  amount: string;
  hash: string;
  valid: boolean;
}

/**
 * The bank lines of a file with their hash for one account. Identical lines of the same day get
 * consecutive occurrence numbers, so two real identical coffees are two lines, and the same file
 * imported twice produces the same hashes.
 */
export function planTransactions(
  accountId: string,
  rows: readonly ParsedRow[],
): PlannedTransaction[] {
  const seen = new Map<string, number>();
  const planned: PlannedTransaction[] = [];
  rows.forEach((row, index) => {
    if (row.kind !== 'bank') return;
    const description = row.description.trim();
    const plain = toPlain(row.amount);
    const valid = description.length > 0 && LEDGER_AMOUNT.test(plain);
    const line = { accountId, date: row.date, description, amount: plain };
    const key = `${row.date}|${normalizeText(description)}|${plain}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    planned.push({
      index,
      date: row.date,
      description,
      amount: plain,
      hash: transactionHash(line, occurrence),
      valid,
    });
  });
  return planned;
}

export interface PlannedOperation {
  /** Position of the first line it comes from. */
  index: number;
  /** Positions of all the lines it comes from. */
  lines: number[];
  type: 'buy' | 'sell' | 'dividend';
  date: string;
  symbol: string;
  name: string | null;
  holder: string | null;
  qty: string | null;
  price: string | null;
  /** Net cash of a dividend. */
  amount: string | null;
  /** Gross dividend. */
  gross: string | null;
  /** Withholding tax (positive); a refund makes it negative. */
  tax: string | null;
  extId: string | null;
}

export interface BrokerPlan {
  operations: PlannedOperation[];
  /** Lines the import does not store: cash movements, interest, fees, lines without a symbol. */
  unsupported: number[];
}

const QTY_PLACES = 8;
const PRICE_PLACES = 6;
const MONEY_PLACES = 4;
const short = (value: string, places: number) => toPlain(roundTo(value, places));

/**
 * The broker lines as operations. A buy or a sell is one operation per line. The dividend of a
 * symbol on a day, the tax withheld on it and a tax refund are separate lines in the file and
 * become one dividend operation: `gross` is the dividends, `tax` what was withheld net of refunds
 * (negative when only a refund came), `amount` the net cash. The operation keeps the smallest
 * broker id of its lines, so a re-import finds it again.
 */
export function planOperations(rows: readonly ParsedRow[]): BrokerPlan {
  const operations: PlannedOperation[] = [];
  const unsupported: number[] = [];
  const groups = new Map<string, { first: number; lines: BrokerParsed[]; indexes: number[] }>();

  rows.forEach((row, index) => {
    if (row.kind !== 'broker') return;
    const type: string = row.type;
    const hasSymbol = row.symbol !== null && row.symbol.trim().length > 0;
    if ((type === 'buy' || type === 'sell') && hasSymbol) {
      const qty = row.quantity;
      const price = row.price;
      if (qty === null || price === null || !dec(qty).gt(0) || dec(price).isNeg()) {
        unsupported.push(index);
        return;
      }
      operations.push({
        index,
        lines: [index],
        type,
        date: row.date,
        symbol: (row.symbol ?? '').trim().toUpperCase(),
        name: nameOf(row),
        holder: row.holder,
        qty: short(qty, QTY_PLACES),
        price: short(price, PRICE_PLACES),
        amount: null,
        gross: null,
        tax: null,
        extId: row.external_id,
      });
    } else if ((type === 'dividend' || type === 'tax' || type === 'refund') && hasSymbol) {
      const key = `${(row.symbol ?? '').trim().toUpperCase()}|${row.date}`;
      const group = groups.get(key) ?? { first: index, lines: [], indexes: [] };
      group.lines.push(row);
      group.indexes.push(index);
      groups.set(key, group);
    } else {
      unsupported.push(index);
    }
  });

  for (const group of groups.values()) {
    const [head] = group.lines;
    if (!head) continue;
    const sum = (types: readonly string[]) =>
      group.lines
        .filter((line) => types.includes(line.type))
        .reduce((total, line) => total.plus(line.amount), dec(0));
    const gross = sum(['dividend']);
    const tax = sum(['tax', 'refund']);
    const ids = group.lines.flatMap((line) => (line.external_id ? [line.external_id] : []));
    operations.push({
      index: group.first,
      lines: group.indexes,
      type: 'dividend',
      date: head.date,
      symbol: (head.symbol ?? '').trim().toUpperCase(),
      name: nameOf(head),
      holder: head.holder,
      qty: null,
      price: null,
      amount: short(toPlain(gross.plus(tax)), MONEY_PLACES),
      gross: gross.isZero() ? null : short(toPlain(gross), MONEY_PLACES),
      tax: tax.isZero() ? null : short(toPlain(tax.neg()), MONEY_PLACES),
      extId: ids.length > 0 ? ([...ids].sort()[0] ?? null) : null,
    });
  }
  operations.sort((a, b) => a.index - b.index);
  return { operations, unsupported };
}

/** The instrument's name, when the parser gives one (extra field of newer parsers). */
function nameOf(row: BrokerParsed): string | null {
  const name = (row as { name?: unknown }).name;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null;
}

/** First-name key of a holder, the way sub-accounts are matched. */
export const holderKey = (holder: string): string => normalizeText(holder);
