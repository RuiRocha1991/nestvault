import {
  accountsRepo,
  assetsRepo,
  investmentOpsRepo,
  poolSettingsRepo,
  subAccountsRepo,
  transactionsRepo,
  type AccountRow,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';
import { accountBalances, dec, toEur, toFxRates } from '@nestvault/domain';

import { toInvestmentOp } from '../investments/domain';
import { loadSavingsLedger } from '../savings/domain';
import { loadFxRates } from '../settings/fx';
import { toEngineTransaction } from '../transactions/engine';

import { toLedgerAccount } from './ledger';
import { toAccountDto, type AccountDto } from './schemas';

/**
 * Accounts as DTOs, with the balance on `today` and its EUR value (the pool's rates). Movements,
 * deposits, manual interest and investment operations feed the balance (one domain function).
 * Must run inside `withPool`.
 */
export async function readAccounts(
  tx: PoolTx,
  ctx: PoolContext,
  today: string,
  only?: string,
  /** Count the investment operations in the balance (the accounts screen does; the list does not yet). */
  options: { withOperations?: boolean } = {},
): Promise<AccountDto[]> {
  const rows = only
    ? [await accountsRepo.find(tx, ctx, only)].filter((row): row is AccountRow => !!row)
    : await accountsRepo.list(tx, ctx);
  const ids = rows.map((row) => row.id);
  const [links, subs, resolved, settings, savings, txRows, opRows, assetRows] = await Promise.all([
    accountsRepo.listHolders(tx, ctx, ids),
    subAccountsRepo.list(tx, ctx),
    loadFxRates(tx, ctx, today),
    poolSettingsRepo.find(tx, ctx),
    loadSavingsLedger(tx, ctx),
    transactionsRepo.listForEngine(tx, ctx),
    investmentOpsRepo.list(tx, ctx),
    assetsRepo.list(tx, ctx),
  ]);
  const rates = toFxRates(resolved);
  const balances = accountBalances(
    {
      accounts: rows.map((row) => toLedgerAccount(row, savings.deposits.get(row.id))),
      transactions: txRows.map(toEngineTransaction),
      interestEntries: savings.interestEntries,
      ops: options.withOperations ? opRows.map(toInvestmentOp) : [],
      assets: (options.withOperations ? assetRows : []).map((row) => ({
        id: row.id,
        currency: row.currency,
        price: '0',
        dps: row.dps,
        divMonths: row.divMonths,
      })),
      moves: [],
      categories: [],
      rates,
      defaultTax: settings?.depositTax ?? '28',
    },
    today,
  );
  return rows.map((row) => {
    const balance = balances.get(row.id) ?? dec(0);
    return toAccountDto(
      row,
      links.filter((link) => link.accountId === row.id).map((link) => link.holderId),
      subs.filter((sub) => sub.accountId === row.id),
      balance,
      toEur(balance, row.currency, rates),
    );
  });
}
