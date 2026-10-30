import { accountBalancesAt, type LedgerData } from './account-balance';
import { dec, sum, type Money } from './decimal';
import { addTo, sumToEur, toEur, type ByCurrency } from './fx';
import { portfolioCash } from './portfolio-cash';
import { computeHoldingsAt } from './positions';
import { realEstateAt } from './real-estate';

export interface NetWorth {
  /** Checking and brokerage accounts plus the cash kept in portfolios. */
  cash: Money;
  /** Savings accounts and term deposits. */
  savings: Money;
  /** Market value of the open positions. */
  investments: Money;
  /** The properties' value to the household (zero without real estate). */
  realEstate: Money;
  /** What the loans still owe (zero without loans). */
  liabilities: Money;
  /** Assets minus liabilities. */
  net: Money;
  /** Native-currency totals; a term deposit counts as EUR. */
  byCurrency: ByCurrency;
  investmentsByCurrency: ByCurrency;
}

/**
 * Net worth in EUR on each of the dates, reading the transactions once. Each account counts once,
 * even when linked to a portfolio. `today` decides which prices are used: the price history for
 * dates before it, the current price from it.
 */
export function netWorths(
  data: LedgerData,
  dates: readonly string[],
  today: string,
  /** The account balances on `dates` when the caller already has them (`accountBalancesAt`). */
  balancesAt: readonly Map<string, Money>[] = accountBalancesAt(data, dates),
): NetWorth[] {
  const { rates } = data;
  const accountById = new Map(data.accounts.map((a) => [a.id, a]));
  const cashAccounts = data.accounts.map((a) => ({ id: a.id, trackCash: a.trackCash !== false }));
  const holdings = computeHoldingsAt(data.ops, data.assets, rates, dates, { today });
  return balancesAt.map((balances, i) => {
    const asOf = dates[i] ?? '';
    const byCurrency: ByCurrency = {};
    const cashParts: Money[] = [];
    const savingsParts: Money[] = [];
    for (const [id, balance] of balances) {
      const account = accountById.get(id);
      if (!account) continue;
      const currency = account.kind === 'term' ? 'EUR' : account.currency;
      addTo(byCurrency, currency, balance);
      (account.kind === 'other' ? cashParts : savingsParts).push(toEur(balance, currency, rates));
    }
    const pfCash = portfolioCash(data.ops, data.moves, cashAccounts, data.assets, rates, { asOf });
    cashParts.push(pfCash);
    addTo(byCurrency, 'EUR', pfCash);

    const investmentsByCurrency: ByCurrency = {};
    for (const h of holdings[i] ?? []) {
      addTo(investmentsByCurrency, h.currency, h.valueN);
    }
    for (const [currency, value] of Object.entries(investmentsByCurrency)) {
      addTo(byCurrency, currency, value);
    }
    const cash = sum(cashParts);
    const savings = sum(savingsParts);
    const investments = sumToEur(investmentsByCurrency, rates);
    const { realEstate, liabilities } = data.realEstate
      ? realEstateAt(data.realEstate, asOf)
      : { realEstate: dec(0), liabilities: dec(0) };
    if (!realEstate.isZero() || !liabilities.isZero()) {
      addTo(byCurrency, 'EUR', realEstate.minus(liabilities));
    }
    return {
      cash,
      savings,
      investments,
      realEstate,
      liabilities,
      net: cash.plus(savings).plus(investments).plus(realEstate).minus(liabilities),
      byCurrency,
      investmentsByCurrency,
    };
  });
}

export function netWorth(data: LedgerData, asOf: string, today: string): NetWorth {
  const [worth] = netWorths(data, [asOf], today);
  if (!worth) throw new RangeError('No net worth computed');
  return worth;
}
