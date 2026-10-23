import {
  accountsRepo,
  assetsRepo,
  investmentOpsRepo,
  subAccountsRepo,
  transactionsRepo,
  type ImportBatchRow,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';
import { addDays, applyRules, detectTransfers, type Transaction } from '@nestvault/domain';

import { loadEngineContext } from '../transactions/engine';

import {
  holderKey,
  planOperations,
  planTransactions,
  type BrokerPlan,
  type PlannedOperation,
} from './plan';
import { ImportPreviewDto, PREVIEW_ROWS_MAX, type PreviewRowDto } from './schemas';
import type { StoredPreview } from './stored';

/** The broker symbols of the pool: matched by the stored symbol, else by the ticker without suffix. */
export function matchAsset(
  assets: readonly { id: string; symbol: string | null; ticker: string }[],
  symbol: string,
): string | null {
  const wanted = symbol.toUpperCase();
  const bare = wanted.replace(/\.[A-Z]{1,3}$/, '');
  const found =
    assets.find((asset) => (asset.symbol ?? '').toUpperCase() === wanted) ??
    assets.find((asset) => asset.ticker.toUpperCase() === bare);
  return found?.id ?? null;
}

export interface BuildPreviewOptions {
  stored: StoredPreview;
  batch: ImportBatchRow;
  /** The account the lines are for; without one the duplicates are unknown. */
  accountId: string | null;
  duplicateFileAt: Date | null;
}

/**
 * The preview the user confirms: each line with whether the account has it, the category the
 * household's rules would give it and the internal transfers it would complete. Read-only: it
 * looks at the pool and writes nothing.
 */
export async function buildPreview(
  tx: PoolTx,
  ctx: PoolContext,
  options: BuildPreviewOptions,
): Promise<ImportPreviewDto> {
  const { stored, batch, accountId } = options;
  const { response } = stored;
  const kind = batch.kind === 'broker' ? 'broker' : 'bank';
  const built =
    kind === 'bank'
      ? await bankRows(tx, ctx, response.rows, accountId)
      : await brokerRows(tx, ctx, response.rows, accountId);

  const skipped = built.rows.filter((row) =>
    row.kind === 'bank' ? !row.valid : !row.supported,
  ).length;
  const duplicates = accountId
    ? built.rows.filter(
        (row) => row.duplicate === true && (row.kind === 'bank' ? row.valid : row.supported),
      ).length
    : null;
  return ImportPreviewDto.parse({
    status: 'preview',
    batchId: batch.id,
    kind,
    fileName: batch.fileName,
    parser: {
      parserId: batch.parserId,
      kind: batch.parserKind,
      version: batch.parserVersion,
      confidence: Number(batch.confidence),
    },
    remembered: stored.remembered,
    accountId,
    reconciled: response.meta.reconciled,
    openingBalance: response.meta.opening_balance,
    closingBalance: response.meta.closing_balance,
    warnings: response.warnings,
    duplicateFile: options.duplicateFileAt
      ? { committedAt: options.duplicateFileAt.toISOString() }
      : null,
    summary: {
      total: built.rows.length,
      new: built.rows.length - skipped - (duplicates ?? 0),
      duplicates,
      skipped,
    },
    rows: built.rows.slice(0, PREVIEW_ROWS_MAX),
    rowsTruncated: built.rows.length > PREVIEW_ROWS_MAX,
    broker: built.broker,
  });
}

async function bankRows(
  tx: PoolTx,
  ctx: PoolContext,
  rows: StoredPreview['response']['rows'],
  accountId: string | null,
) {
  const planned = planTransactions(accountId ?? ZERO_ID, rows);
  const known = accountId
    ? await transactionsRepo.existingHashes(
        tx,
        ctx,
        accountId,
        planned.map((line) => line.hash),
      )
    : null;

  // Categories and transfers are decided for the lines that would be written.
  const suggestions = new Map<number, { categoryId: string | null; transfer: boolean }>();
  const paired = new Set<number>();
  if (accountId) {
    const engine = await loadEngineContext(tx, ctx);
    const fresh = planned.filter((line) => line.valid && !known?.has(line.hash));
    const asTransaction = (line: (typeof planned)[number]): Transaction => ({
      id: `new:${line.index}`,
      accountId,
      date: line.date,
      amount: line.amount,
      description: line.description,
    });
    for (const line of fresh) {
      const decided = applyRules(asTransaction(line), engine.rules);
      suggestions.set(line.index, {
        categoryId: decided?.categoryId ?? null,
        transfer: decided?.transfer ?? false,
      });
    }
    if (fresh.length > 0) {
      const dates = fresh.map((line) => line.date).sort();
      const around = await transactionsRepo.window(
        tx,
        ctx,
        addDays(dates[0] ?? '', -engine.days),
        addDays(dates[dates.length - 1] ?? '', engine.days),
      );
      const existing: Transaction[] = around.map((row) => ({ ...row }));
      const newcomers = fresh.map((line) => {
        const decided = suggestions.get(line.index);
        return {
          ...asTransaction(line),
          categoryId: decided?.categoryId ?? null,
          transfer: decided?.transfer ?? false,
        };
      });
      for (const pair of detectTransfers(
        [...existing, ...newcomers],
        engine.transferAccounts,
        engine.categories,
        {
          days: engine.days,
        },
      )) {
        for (const id of [pair.outflowId, pair.inflowId]) {
          if (id.startsWith('new:')) paired.add(Number(id.slice(4)));
        }
      }
    }
  }

  const out: PreviewRowDto[] = [];
  for (const line of planned) {
    const row = rows[line.index];
    if (row?.kind !== 'bank') continue;
    const suggestion = suggestions.get(line.index);
    out.push({
      index: line.index,
      kind: 'bank',
      date: line.date,
      description: line.description,
      amount: line.amount,
      balance: row.balance,
      duplicate: known ? known.has(line.hash) : null,
      categoryId: suggestion?.categoryId ?? null,
      transfer: suggestion?.transfer ?? false,
      transferPair: paired.has(line.index),
      valid: line.valid,
    });
  }
  return { rows: out, broker: null };
}

const ZERO_ID = '00000000-0000-7000-8000-000000000000';

async function brokerRows(
  tx: PoolTx,
  ctx: PoolContext,
  rows: StoredPreview['response']['rows'],
  accountId: string | null,
) {
  const plan = planOperations(rows);
  const ids = plan.operations.flatMap((op) => (op.extId ? [op.extId] : []));
  const known = accountId ? await investmentOpsRepo.existingExtIds(tx, ctx, accountId, ids) : null;
  const opOfLine = new Map<number, PlannedOperation>();
  for (const op of plan.operations) for (const line of op.lines) opOfLine.set(line, op);

  const out: PreviewRowDto[] = [];
  rows.forEach((row, index) => {
    if (row.kind !== 'broker') return;
    const op = opOfLine.get(index);
    out.push({
      index,
      kind: 'broker',
      date: row.date,
      type: row.type,
      symbol: row.symbol,
      quantity: row.quantity,
      price: row.price,
      amount: row.amount,
      currency: row.currency,
      holder: row.holder,
      duplicate: known && op ? Boolean(op.extId && known.has(op.extId)) : null,
      supported: op !== undefined,
    });
  });

  const [assets, subs, account] = await Promise.all([
    assetsRepo.list(tx, ctx),
    subAccountsRepo.list(tx, ctx),
    accountId ? accountsRepo.find(tx, ctx, accountId) : Promise.resolve(undefined),
  ]);
  return {
    rows: out,
    broker: brokerSummary(plan, assets, subs, accountId, account?.portfolioId ?? null),
  };
}

function brokerSummary(
  plan: BrokerPlan,
  assets: readonly { id: string; symbol: string | null; ticker: string }[],
  subs: readonly { id: string; accountId: string; name: string }[],
  accountId: string | null,
  portfolioId: string | null,
) {
  const symbols = new Map<string, string | null>();
  for (const op of plan.operations) if (!symbols.has(op.symbol)) symbols.set(op.symbol, op.name);
  const holders = [...new Set(plan.operations.flatMap((op) => (op.holder ? [op.holder] : [])))];
  const own = subs.filter((sub) => sub.accountId === accountId);
  return {
    symbols: [...symbols].map(([symbol, name]) => ({
      symbol,
      name,
      assetId: matchAsset(assets, symbol),
    })),
    holders: holders.map((holder) => ({
      holder,
      subAccountId: own.find((sub) => holderKey(sub.name) === holderKey(holder))?.id ?? null,
    })),
    portfolioId,
  };
}
