import type { DepositRow } from '@nestvault/db';
import {
  accountBalancesAt,
  accountInterest,
  addMonths,
  cashEffect,
  cashEffectNative,
  daysBetween,
  dec,
  depositFlows,
  depositMaturity,
  depositReturnTo,
  depositSchedule,
  depositValue,
  fx,
  indexAssets,
  interestLast12Months,
  interestTotal,
  isScheduled,
  lastMonths,
  monthEnd,
  monthKey,
  portfolioSummary,
  roundTo,
  sum,
  sumToEur,
  toPlain,
  type ByCurrency,
  type Dec,
  type Deposit,
  type FxRates,
  type InvestmentAsset,
  type InvestmentOp,
  type LedgerAccount,
  type LedgerData,
  type ManualInterestEntry,
  type PortfolioCashMove,
  type PortfolioSummary,
  type SummaryAccount,
  type Transaction,
} from '@nestvault/domain';

import { toDomainDeposit } from '../savings/domain';

import type {
  AccountCardDto,
  AccountsScreenDto,
  BrokerageDto,
  TermDepositDto,
} from './screen-schemas';
import type { AccountDto } from './schemas';

/** What the accounts screen reads, already loaded for one pool. */
export interface ScreenInput {
  today: string;
  accounts: readonly AccountDto[];
  /** The stored rows of the pool's deposits, by account. */
  depositRows: readonly DepositRow[];
  transactions: readonly Transaction[];
  interestEntries: readonly ManualInterestEntry[];
  ops: readonly InvestmentOp[];
  assets: readonly InvestmentAsset[];
  moves: readonly PortfolioCashMove[];
  rates: FxRates;
  /** Default tax on deposit interest, in percent. */
  defaultTax: string;
}

const RECENT_INTEREST = 4;
const PAST_PAYMENTS = 3;
const NEXT_PAYMENTS = 2;

const plain = (value: Dec) => toPlain(roundTo(value, 4));
const percent = (value: Dec) => toPlain(roundTo(value.times(100), 4));

const kindOf = (type: AccountDto['type']): LedgerAccount['kind'] =>
  type === 'term_deposit' ? 'term' : type === 'savings' ? 'savings' : 'other';

/** Operation effect on the account balance in the account's currency (like the balance engine). */
function accountEffect(
  op: InvestmentOp,
  currency: string,
  asset: InvestmentAsset | undefined,
  rates: FxRates,
): Dec {
  if (asset?.currency === currency) return cashEffectNative(op, asset, rates);
  return cashEffect(op, asset, rates).div(fx(currency, rates));
}

/** A by-currency map as one number in `currency`. */
const inCurrency = (map: Readonly<ByCurrency>, currency: string, rates: FxRates): Dec =>
  sumToEur(map, rates).div(fx(currency, rates));

function termCard(
  row: DepositRow,
  deposit: Deposit,
  input: ScreenInput,
  accountIds: ReadonlySet<string>,
): TermDepositDto {
  const { today, defaultTax } = input;
  const value = depositValue(deposit, today, defaultTax);
  const schedule = depositSchedule(deposit, today, defaultTax);
  const maturity = depositMaturity(deposit);
  const tax = row.tax ?? defaultTax;
  const scheduled = isScheduled(deposit);
  const { gross } = value;
  const net = scheduled ? value.paid : value.net;
  const total = maturity && row.start ? daysBetween(row.start, maturity) : 0;
  const done = total > 0 ? Math.min(1, Math.max(0, daysBetween(row.start, today) / total)) : 0;
  const paid = schedule
    .filter((p) => p.date <= today)
    .slice(-PAST_PAYMENTS)
    .reverse();
  const planned = schedule.filter((p) => p.date > today).slice(0, NEXT_PAYMENTS);
  const returnTo = depositReturnTo(deposit);
  const toDto = (p: (typeof schedule)[number], status: 'planned' | 'paid') => ({
    date: p.date,
    days: p.days,
    gross: plain(p.gross),
    net: plain(p.net),
    status,
  });
  return {
    depositId: row.id,
    productId: row.productId,
    capital: plain(dec(row.capital)),
    rate: toPlain(row.rate),
    start: row.start,
    maturity,
    payN: row.payN,
    payU: row.payU as TermDepositDto['payU'],
    termN: row.termN,
    termU: row.termU as TermDepositDto['termU'],
    scheduled,
    capitalize: row.capitalize,
    tax: toPlain(tax),
    payToAccountId: row.payToAccountId,
    returnToAccountId: returnTo && accountIds.has(returnTo) ? returnTo : null,
    gross: plain(gross),
    withheld: plain(gross.minus(net)),
    net: plain(net),
    accrued: plain(value.accrued),
    annualEstimate: plain(
      dec(row.capital)
        .times(dec(row.rate).div(100))
        .times(dec(1).minus(dec(tax).div(100))),
    ),
    next: value.next ? { date: value.next.date, net: plain(value.next.net) } : null,
    matured: value.matured,
    progress: maturity ? Math.round(done * 100) : null,
    payments: [
      ...planned.reverse().map((p) => toDto(p, 'planned')),
      ...paid.map((p) => toDto(p, 'paid')),
    ],
  };
}

function brokerageCard(
  account: AccountDto,
  input: ScreenInput,
  summaryAccounts: readonly SummaryAccount[],
  txs: readonly Transaction[],
): BrokerageDto {
  const { today, rates, ops, assets, moves } = input;
  const scope = { asOf: today, today, accountId: account.id };
  const data = { ops, assets, accounts: summaryAccounts, moves, rates };
  const summary: PortfolioSummary = portfolioSummary(data, scope);
  const byAsset = indexAssets(assets);
  const own = ops.filter((op) => op.accountId === account.id && op.date <= today);
  const currency = account.currency;
  const effect = (op: InvestmentOp) => accountEffect(op, currency, byAsset.get(op.assetId), rates);
  const hasDividends = own.some((op) => op.type === 'div');
  const dividends = hasDividends
    ? {
        gross: plain(inCurrency(summary.divGrossBy, currency, rates)),
        tax: plain(inCurrency(summary.taxBy, currency, rates).neg()),
        refund: plain(inCurrency(summary.refundBy, currency, rates)),
        net: plain(inCurrency(summary.divsBy, currency, rates)),
        net12Months: plain(inCurrency(summary.divs12By, currency, rates)),
      }
    : null;
  return {
    trackCash: account.trackCash,
    valueBy: Object.fromEntries(
      Object.entries(summary.valueBy).map(([ccy, amount]) => [ccy, plain(amount)]),
    ),
    valueEur: plain(summary.value),
    positions: summary.positions,
    totalPct: summary.positions > 0 ? percent(summary.totalPct) : null,
    subAccounts: account.subAccounts.map((sub) => {
      const part = portfolioSummary(data, { ...scope, subAccountId: sub.id });
      return {
        id: sub.id,
        name: sub.name,
        holderId: sub.holderId,
        valueEur: plain(part.value),
        totalPct: part.positions > 0 ? percent(part.totalPct) : null,
      };
    }),
    deposits: plain(sum(txs.filter((t) => dec(t.amount).gt(0)).map((t) => t.amount))),
    withdrawals: plain(sum(txs.filter((t) => dec(t.amount).lt(0)).map((t) => dec(t.amount).neg()))),
    buys: plain(sum(own.filter((op) => op.type === 'buy').map((op) => effect(op).neg()))),
    sells: plain(sum(own.filter((op) => op.type === 'sell').map(effect))),
    dividends,
  };
}

/**
 * The cards of the Contas e poupanças screen: every account with its balance (in its currency and
 * in EUR) and, by type, interest received, deposit schedule or investment figures. Pure: all the
 * rows are loaded by the caller.
 */
export function buildAccountsScreen(input: ScreenInput): AccountsScreenDto {
  const { today, accounts, depositRows, transactions, interestEntries, rates, defaultTax } = input;
  const accountIds = new Set(accounts.map((account) => account.id));
  const depositByAccount = new Map(depositRows.map((row) => [row.accountId, row]));
  const deposits = new Map<string, Deposit>(
    depositRows.map((row) => [row.accountId, toDomainDeposit(row)]),
  );

  // Balances at the month ends of the last 12 months give the effective rate of an account.
  const months = lastMonths(12, today);
  const dates = months.map((key) => (key === monthKey(today) ? today : monthEnd(key)));
  const ledger: LedgerData = {
    accounts: accounts.map((account) => ({
      id: account.id,
      currency: account.currency,
      kind: kindOf(account.type),
      isBrokerage: account.type === 'brokerage',
      trackCash: account.trackCash,
      opening: account.opening,
      openingDate: account.openingDate,
      portfolioId: account.portfolioId,
      deposit: deposits.get(account.id) ?? null,
    })),
    transactions,
    interestEntries,
    ops: input.ops,
    assets: input.assets,
    moves: input.moves,
    categories: [],
    rates,
    defaultTax,
  };
  const monthly = accountBalancesAt(ledger, dates);
  const allDeposits = [...deposits.values()];

  const summaryAccounts: SummaryAccount[] = accounts.map((account) => ({
    id: account.id,
    currency: account.currency,
    trackCash: account.trackCash,
    isBrokerage: account.type === 'brokerage',
    portfolioId: account.portfolioId,
    balance: account.balance,
    interest: '0',
  }));

  const cards = accounts.map((account): AccountCardDto => {
    const txs = transactions.filter((t) => t.accountId === account.id);
    const row = depositByAccount.get(account.id);
    const showInterest = account.type === 'savings' || account.type === 'checking';
    let interest: AccountCardDto['interest'] = null;
    if (showInterest) {
      const entries = accountInterest(
        {
          manual: interestEntries.filter((entry) => entry.accountId === account.id),
          transactions: txs,
        },
        today,
        defaultTax,
      );
      if (account.type === 'savings' || entries.length > 0) {
        const last12 = interestLast12Months(entries, today);
        const positive = monthly
          .map((balances) => balances.get(account.id) ?? dec(0))
          .filter((balance) => balance.gt(0));
        const average = positive.length ? sum(positive).div(positive.length) : dec(0);
        const manualIds = new Set(interestEntries.map((entry) => entry.id));
        interest = {
          last12Months: plain(last12),
          total: plain(interestTotal(entries, today)),
          effectiveRate:
            average.gt(0) && !last12.isZero() ? plain(last12.div(average).times(100)) : null,
          recent: entries.slice(0, RECENT_INTEREST).map((entry) => ({
            id: entry.id,
            date: entry.date,
            amount: plain(entry.amount),
            source: manualIds.has(entry.id) ? ('manual' as const) : ('statement' as const),
          })),
        };
      }
    }

    let pendingDeposits: AccountCardDto['pendingDeposits'] = null;
    if (account.type === 'checking' || account.type === 'savings') {
      const flows = allDeposits.length
        ? depositFlows(account.id, allDeposits, addMonths(today, 24), defaultTax)
        : [];
      if (flows.length) {
        const lastTx = txs.reduce((latest, t) => (t.date > latest ? t.date : latest), '');
        const arrived = sum(
          flows.filter((f) => f.date <= today && f.date > lastTx).map((f) => f.amount),
        );
        const next = flows
          .filter((f) => f.date > today)
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        if (!arrived.isZero() || next) {
          pendingDeposits = {
            amount: plain(arrived),
            next: next ? { date: next.date, amount: plain(next.amount) } : null,
          };
        }
      }
    }

    const deposit = deposits.get(account.id);
    return {
      ...account,
      movements: txs.length,
      interest,
      pendingDeposits,
      term:
        account.type === 'term_deposit' && row && deposit
          ? termCard(row, deposit, input, accountIds)
          : null,
      brokerage:
        account.type === 'brokerage' ? brokerageCard(account, input, summaryAccounts, txs) : null,
    };
  });

  const totals: Record<string, Dec> = {};
  for (const account of accounts) {
    totals[account.type] = (totals[account.type] ?? dec(0)).plus(account.balanceEur);
  }
  return {
    asOf: today,
    accounts: cards,
    totalsEur: Object.fromEntries(
      (['checking', 'savings', 'term_deposit', 'brokerage'] as const).map((type) => [
        type,
        plain(totals[type] ?? dec(0)),
      ]),
    ) as AccountsScreenDto['totalsEur'],
  };
}
