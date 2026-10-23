import {
  accountsRepo,
  assetsRepo,
  investmentOpsRepo,
  newId,
  portfoliosRepo,
  subAccountsRepo,
  transactionsRepo,
  type AccountRow,
  type ImportBatchRow,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';
import { addDays, applyRules, dec, detectTransfers, roundTo, toPlain } from '@nestvault/domain';

import { ValidationError } from '../errors';
import { linkCashMoves } from '../investments/cash-moves-match';
import { loadEngineContext, toEngineTransaction } from '../transactions/engine';

import { holderKey, planOperations, planTransactions } from './plan';
import { matchAsset } from './preview-dto';
import type { CommitImportInput } from './schemas';
import type { StoredPreview } from './stored';

export interface CommitOutcome {
  inserted: number;
  duplicates: number;
  skipped: number;
  categorized: number;
  transfersPaired: number;
  assetsCreated: number;
  openingBalanceAdjusted: boolean;
}

export interface CommitArgs {
  tx: PoolTx;
  ctx: PoolContext;
  batch: ImportBatchRow;
  stored: StoredPreview;
  account: AccountRow;
  /** Already parsed: defaults filled in. */
  input: ReturnType<typeof parsedInput>;
}

/** The parsed shape of `CommitImportInput` (defaults applied). */
export const parsedInput = (input: CommitImportInput) => ({
  accountId: input.accountId,
  adjustOpeningBalance: input.adjustOpeningBalance ?? false,
  portfolioId: input.portfolioId ?? null,
  assets: input.assets ?? {},
  newAssets: input.newAssets ?? [],
  subAccounts: input.subAccounts ?? {},
});

const invalid = (path: string, message: string) =>
  new ValidationError('The request is not valid.', [{ path, message }]);

const EMPTY: CommitOutcome = {
  inserted: 0,
  duplicates: 0,
  skipped: 0,
  categorized: 0,
  transfersPaired: 0,
  assetsCreated: 0,
  openingBalanceAdjusted: false,
};

/**
 * Writes the lines of a bank statement into the account. A line the account already has (same
 * hash) is left alone, so the same file twice adds nothing and a category, transfer flag or note
 * the household set is never overwritten. New lines get the category the household's rules give,
 * then the transfers they complete are paired.
 */
export async function commitBank({ tx, ctx, batch, stored, account, input }: CommitArgs) {
  const rows = stored.response.rows;
  const planned = planTransactions(account.id, rows);
  const outcome = { ...EMPTY };
  const engine = await loadEngineContext(tx, ctx);
  const known = await transactionsRepo.existingHashes(
    tx,
    ctx,
    account.id,
    planned.map((line) => line.hash),
  );

  const added = new Map<string, string>(); // id -> date
  for (const line of planned) {
    if (!line.valid) {
      outcome.skipped += 1;
      continue;
    }
    if (known.has(line.hash)) {
      outcome.duplicates += 1;
      continue;
    }
    const id = newId();
    const decided = applyRules(
      {
        id,
        accountId: account.id,
        date: line.date,
        amount: line.amount,
        description: line.description,
      },
      engine.rules,
    );
    const inserted = await transactionsRepo.insertIgnoringDuplicate(tx, ctx, id, {
      accountId: account.id,
      date: line.date,
      description: line.description,
      amount: line.amount,
      categoryId: decided?.categoryId ?? null,
      transfer: decided?.transfer ?? false,
      transferLocked: false,
      manualCategory: false,
      hash: line.hash,
      importBatchId: batch.id,
    });
    if (!inserted) {
      outcome.duplicates += 1; // written by another import since the look-up
      continue;
    }
    outcome.inserted += 1;
    if (decided?.categoryId) outcome.categorized += 1;
    added.set(id, line.date);
  }

  if (added.size > 0) {
    const dates = [...added.values()].sort();
    const window = await transactionsRepo.window(
      tx,
      ctx,
      addDays(dates[0] ?? '', -engine.days),
      addDays(dates[dates.length - 1] ?? '', engine.days),
    );
    const pairs = detectTransfers(
      window.map(toEngineTransaction),
      engine.transferAccounts,
      engine.categories,
      {
        days: engine.days,
      },
    ).filter((pair) => added.has(pair.outflowId) || added.has(pair.inflowId));
    for (const pair of pairs) await transactionsRepo.pair(tx, ctx, pair);
    outcome.transfersPaired = pairs.length;
    // A line that is the other side of a portfolio cash move is a transfer, not income.
    for (const day of new Set(added.values())) await linkCashMoves(tx, ctx, day);
  }

  if (input.adjustOpeningBalance) {
    outcome.openingBalanceAdjusted = await adjustOpening(tx, ctx, account, stored, planned);
  }
  return outcome;
}

/**
 * Sets the opening balance so that the account's balance on the statement's last day equals the
 * statement's closing balance (the prototype's behaviour): opening = closing − Σ movements.
 */
async function adjustOpening(
  tx: PoolTx,
  ctx: PoolContext,
  account: AccountRow,
  stored: StoredPreview,
  planned: ReturnType<typeof planTransactions>,
): Promise<boolean> {
  const closing = stored.response.meta.closing_balance;
  const days = planned
    .filter((line) => line.valid)
    .map((line) => line.date)
    .sort();
  const newest = days[days.length - 1];
  if (closing === null || newest === undefined) {
    throw invalid('adjustOpeningBalance', 'the statement has no closing balance');
  }
  const movements = await transactionsRepo.sumUpTo(tx, ctx, account.id, newest);
  const opening = toPlain(roundTo(dec(closing).minus(movements), 4));
  await accountsRepo.update(tx, ctx, account.id, {
    type: account.type,
    name: account.name,
    institution: account.institution,
    iban: account.iban,
    currency: account.currency,
    opening,
    openingDate: account.openingDate,
    trackCash: account.trackCash,
    groupName: account.groupName,
    portfolioId: account.portfolioId,
    rate: account.rate,
    xtbAccountNo: account.xtbAccountNo,
  });
  return opening !== toPlain(account.opening);
}

/**
 * Writes the operations of a broker file into a brokerage account: buys, sells and dividends
 * (a dividend, its withholding tax and refund as one operation). An operation whose broker id the
 * account already has is left alone. Every symbol needs an asset (an existing one, matched by its
 * symbol or chosen in `assets`, or one created from `newAssets`) or nothing is written.
 */
export async function commitBroker({ tx, ctx, stored, account, input }: CommitArgs) {
  const plan = planOperations(stored.response.rows);
  const outcome = { ...EMPTY, skipped: plan.unsupported.length };

  const portfolioId = input.portfolioId ?? account.portfolioId;
  if (!portfolioId) throw invalid('portfolioId', 'choose the portfolio of these operations');
  if (!(await portfoliosRepo.find(tx, ctx, portfolioId))) {
    throw invalid('portfolioId', 'not a portfolio of this pool');
  }

  const assets = await assetsRepo.list(tx, ctx);
  const byId = new Set(assets.map((asset) => asset.id));
  const symbols = [...new Set(plan.operations.map((op) => op.symbol))];
  const resolved = new Map<string, string>();
  const missing: string[] = [];
  const wanted = new Map(input.newAssets.map((asset) => [asset.symbol.toUpperCase(), asset]));
  for (const symbol of symbols) {
    const chosen = input.assets[symbol];
    if (chosen !== undefined) {
      if (!byId.has(chosen)) throw invalid(`assets.${symbol}`, 'not an asset of this pool');
      resolved.set(symbol, chosen);
      continue;
    }
    const matched = matchAsset(assets, symbol);
    if (matched) resolved.set(symbol, matched);
    else if (!wanted.has(symbol)) missing.push(symbol);
  }
  if (missing.length > 0) {
    throw new ValidationError(
      'The request is not valid.',
      missing.map((symbol) => ({
        path: `assets.${symbol}`,
        message: 'choose or create the asset',
      })),
    );
  }
  for (const symbol of symbols) {
    if (resolved.has(symbol)) continue;
    const asset = wanted.get(symbol);
    if (!asset) continue;
    const id = newId();
    await assetsRepo.insert(tx, ctx, id, {
      ticker: asset.ticker,
      symbol: asset.symbol,
      name: asset.name,
      type: asset.type,
      currency: asset.currency,
      sector: asset.sector ?? null,
      region: asset.region ?? null,
      dps: asset.dps ?? null,
      divMonths: asset.divMonths ?? [],
    });
    resolved.set(symbol, id);
    outcome.assetsCreated += 1;
  }

  const subs = (await subAccountsRepo.list(tx, ctx)).filter((sub) => sub.accountId === account.id);
  const chosenSubs = new Map<string, string | null>();
  for (const [holder, id] of Object.entries(input.subAccounts)) {
    if (id !== null && !subs.some((sub) => sub.id === id)) {
      throw invalid(`subAccounts.${holder}`, 'not a sub-account of this account');
    }
    chosenSubs.set(holderKey(holder), id);
  }
  const subAccountOf = (holder: string | null): string | null => {
    if (!holder) return null;
    const key = holderKey(holder);
    if (chosenSubs.has(key)) return chosenSubs.get(key) ?? null;
    return subs.find((sub) => holderKey(sub.name) === key)?.id ?? null;
  };

  for (const op of plan.operations) {
    const assetId = resolved.get(op.symbol);
    if (!assetId) continue;
    const inserted = await investmentOpsRepo.insertIgnoringExtId(tx, ctx, newId(), {
      portfolioId,
      assetId,
      accountId: account.id,
      subAccountId: subAccountOf(op.holder),
      type: op.type,
      date: op.date,
      qty: op.qty,
      price: op.price,
      fee: null,
      amount: op.amount,
      gross: op.gross,
      tax: op.tax,
      fromCash: false,
      planId: null,
      planPeriod: null,
      extId: op.extId,
      note: null,
    });
    if (inserted) outcome.inserted += 1;
    else outcome.duplicates += 1;
  }
  return outcome;
}
