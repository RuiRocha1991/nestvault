import { addMonths, monthKey, monthsBetween } from './dates';
import { dec, sum, type Dec, type DecInput, type Money } from './decimal';
import { toEur, type FxRates } from './fx';
import {
  portfolioSummary,
  type PortfolioSummaryInput,
  type SummaryAccount,
} from './portfolio-summary';
import { cashEffect, indexAssets, inPortfolios, type InvestmentOp } from './positions';

/**
 * Goals engine: port of the prototype's `goalKeys`, `goalScope` and `goalCalc`. Pure: the caller
 * passes the pool's data (balances and interest already computed by the account and deposit
 * engines) and `asOf`, which plays the role of the prototype's `today()`.
 */

export type GoalType = 'value' | 'invested' | 'income' | 'contrib';
/** `date` = deadline, `eta` = compute when it is reached, `none` = just track. */
export type GoalMode = 'date' | 'eta' | 'none';

export interface Goal {
  type: GoalType;
  /** Target in EUR (a yearly income for `income`, an amount bought in the year for `contrib`). */
  target: DecInput;
  /** Expected annual return in percent. Ignored for `invested`. */
  rate?: DecInput | null;
  /** Planned monthly contribution in EUR. */
  monthly?: DecInput | null;
  /** Dividend yield in percent used to turn an income target into a value target. */
  yield?: DecInput | null;
  /** Deadline as `yyyy-mm-dd` (or `yyyy-mm`); required by `contrib` and by mode `date`. */
  deadline?: string | null;
  /** Ignored by `contrib`, which always has a deadline. Defaults to `date`. */
  when?: GoalMode | null;
  /** Portfolios in scope; empty or missing means all. Ignored when `accounts` is set. */
  portfolioIds?: readonly string[] | null;
  /** Accounts (`accountId`) or sub-accounts (`accountId|subAccountId`) in scope. */
  accounts?: readonly string[] | null;
  /** Also count savings and term-deposit accounts that no scoped portfolio already holds. */
  includeSavings?: boolean;
}

/** A summary account plus what goals need: its name, kind and sub-accounts. */
export interface GoalAccount extends SummaryAccount {
  name: string;
  /** Savings and term deposits can be added to a portfolio scope with `includeSavings`. */
  kind: 'term' | 'savings' | 'other';
  /** Principal of a term deposit, in EUR. */
  capital?: DecInput | null;
  /** A term deposit that was already paid back no longer counts as invested. */
  returned?: boolean;
  subAccounts?: readonly { id: string; name: string }[];
}

/** A monthly investment plan. */
export interface GoalPlan {
  active: boolean;
  amount: DecInput;
  portfolioId?: string | null;
  accountId?: string | null;
  subAccountId?: string | null;
}

export interface GoalData extends Omit<PortfolioSummaryInput, 'accounts'> {
  accounts: readonly GoalAccount[];
  portfolios: readonly { id: string; name: string }[];
  plans: readonly GoalPlan[];
}

export interface GoalScope {
  /** Portfolio yield of the scope (`income / value`), the fallback for an income goal. */
  yld: Dec;
  value: Money;
  invested: Money;
  /** Annual income of the open positions. */
  income: Money;
  /** Value of the investments only (without cash and savings). */
  investedValue: Money;
  ops: InvestmentOp[];
  plans: GoalPlan[];
  /** Names of the chosen portfolios or accounts; empty means all portfolios. */
  names: string[];
  includesSavings: boolean;
}

export type GoalStatus = 'reached' | 'on_track' | 'behind' | 'eta' | 'no_contribution' | 'tracking';

export interface GoalPathPoint {
  month: number;
  /** Projection with the planned contribution. */
  planned: Dec;
  /** Projection with the required contribution; `null` when there is none (eta mode). */
  required: Dec | null;
}

export interface GoalResult {
  scope: GoalScope;
  mode: GoalMode;
  current: Dec;
  target: Dec;
  projected: Dec | null;
  /**
   * Monthly contribution needed to hit the target at the deadline. For an income goal it is a
   * capital contribution (value terms), not income.
   */
  required: Dec | null;
  /** Months until the target is reached with the planned contribution, if within 1 200. */
  reachIn: number | null;
  /** `yyyy-mm` in which the target is reached. */
  etaMonth: string | null;
  /** Months to the deadline (or to the eta, 120 when it is never reached); 0 in mode `none`. */
  months: number;
  progress: Dec;
  done: boolean;
  onTrack: boolean;
  status: GoalStatus;
  /** Yield used for an income goal, as a fraction; 0 otherwise. */
  yld: Dec;
  path: GoalPathPoint[];
  monthly: Dec;
}

const MAX_MONTHS = 1200;
const ETA_FALLBACK_MONTHS = 120;
const MAX_PATH_STEPS = 24;
const DEFAULT_YIELD = dec('0.03');
const ON_TRACK_RATIO = dec('0.999');
const EPSILON = dec('1e-6');
const ZERO = dec(0);

const num = (value: DecInput | null | undefined): Dec => dec(value ?? 0);
const atLeastZero = (value: Dec): Dec => (value.isNegative() ? ZERO : value);

function accountEur(account: GoalAccount, rates: FxRates): Dec {
  return toEur(account.balance, account.currency, rates);
}

function accountMatches(
  target: { accountId?: string | null; subAccountId?: string | null },
  key: string,
): boolean {
  const [accountId, subAccountId] = key.split('|');
  if (target.accountId !== accountId) return false;
  return subAccountId === undefined || (target.subAccountId ?? null) === subAccountId;
}

/**
 * Valid scope keys: the account (and sub-account) must exist, and a sub-account key is dropped
 * when its whole account is chosen too.
 */
export function goalKeys(goal: Pick<Goal, 'accounts'>, accounts: readonly GoalAccount[]): string[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const keys = [...new Set(goal.accounts ?? [])].filter((key) => {
    const [accountId, subId] = key.split('|');
    const account = byId.get(accountId ?? '');
    if (!account) return false;
    return !key.includes('|') || !!account.subAccounts?.some((s) => s.id === subId);
  });
  return keys.filter((key) => !(key.includes('|') && keys.includes(key.split('|')[0] ?? '')));
}

function keyName(key: string, accounts: readonly GoalAccount[]): string {
  const [accountId, subId] = key.split('|');
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return '';
  const sub = account.subAccounts?.find((s) => s.id === subId);
  return sub ? `${account.name} · ${sub.name}` : account.name;
}

/** Value, invested amount, income, operations and plans a goal looks at. */
export function goalScope(goal: Goal, data: GoalData, asOf: string): GoalScope {
  const { accounts, rates } = data;
  const options = { asOf, today: asOf };
  const keys = goalKeys(goal, accounts);

  if (!keys.length) {
    const portfolioIds = goal.portfolioIds?.length ? goal.portfolioIds : null;
    const S = portfolioSummary(data, { ...options, portfolioIds });
    const savings = goal.includeSavings
      ? accounts.filter(
          (a) =>
            (a.kind === 'term' || a.kind === 'savings') &&
            !(a.portfolioId && inPortfolios(portfolioIds, a.portfolioId)),
        )
      : [];
    const savingsValue = sum(savings.map((a) => accountEur(a, rates)));
    const savingsInvested = sum(
      savings.map((a) =>
        a.kind === 'term'
          ? num(a.capital)
          : accountEur(a, rates).minus(toEur(a.interest, a.currency, rates)),
      ),
    );
    return {
      yld: S.yld,
      value: S.valueAll.plus(savingsValue),
      invested: S.netInvested.plus(savingsInvested),
      income: S.income,
      investedValue: S.value,
      ops: data.ops.filter((op) => inPortfolios(portfolioIds, op.portfolioId)),
      plans: data.plans.filter((p) => inPortfolios(portfolioIds, p.portfolioId)),
      names: portfolioIds
        ? portfolioIds.flatMap((id) => data.portfolios.find((p) => p.id === id)?.name ?? [])
        : [],
      includesSavings: !!goal.includeSavings,
    };
  }

  let value = ZERO;
  let invested = ZERO;
  let income = ZERO;
  let investedValue = ZERO;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const key of keys) {
    const [accountId, subId] = key.split('|');
    const account = byId.get(accountId ?? '');
    if (!account) continue;
    const S = portfolioSummary(data, {
      ...options,
      accountId: account.id,
      ...(subId ? { subAccountId: subId } : {}),
    });
    income = income.plus(S.income);
    investedValue = investedValue.plus(S.value);
    if (subId || account.isBrokerage) {
      value = value.plus(S.valueAll);
      invested = invested.plus(S.netInvested);
      continue;
    }
    const balance = accountEur(account, rates);
    value = value.plus(balance).plus(S.value);
    let own = balance;
    if (account.kind === 'term') own = account.returned ? ZERO : num(account.capital);
    else if (account.kind === 'savings') {
      own = balance.minus(toEur(account.interest, account.currency, rates));
    }
    invested = invested.plus(own).plus(S.value.isZero() ? ZERO : S.netInvested);
  }
  return {
    yld: investedValue.isZero() ? ZERO : income.div(investedValue),
    value,
    invested,
    income,
    investedValue,
    ops: data.ops.filter((op) => keys.some((k) => accountMatches(op, k))),
    plans: data.plans.filter((p) => keys.some((k) => accountMatches(p, k))),
    names: keys.map((k) => keyName(k, accounts)),
    includesSavings: false,
  };
}

/** `(1 + r)^(1/12) − 1`; 0 for `invested` goals, which do not grow. */
function monthlyRate(goal: Goal): Dec {
  if (goal.type === 'invested') return ZERO;
  const annual = dec(1).plus(num(goal.rate).div(100));
  if (annual.lte(0)) throw new RangeError('The rate must be above -100%');
  return annual.pow(dec(1).div(12)).minus(1);
}

/** Future value after `months` of monthly contributions `pmt` at monthly rate `i`. */
function futureValue(i: Dec, pv: Dec, months: number, pmt: Dec): Dec {
  if (i.isZero()) return pv.plus(pmt.times(months));
  const growth = dec(1).plus(i).pow(months);
  return pv.times(growth).plus(pmt.times(growth.minus(1)).div(i));
}

/** Months to the deadline; a goal that needs one without it is a caller bug. */
function monthsToDeadline(asOf: string, deadline: string | null | undefined): number {
  if (!deadline) throw new RangeError('The goal needs a deadline');
  return Math.max(0, monthsBetween(asOf, deadline));
}

/** `contrib` goal: money bought in the deadline year against the target. */
function contributionGoal(goal: Goal, scope: GoalScope, data: GoalData, asOf: string) {
  const months = monthsToDeadline(asOf, goal.deadline);
  const year = (goal.deadline ?? '').slice(0, 4);
  const assets = indexAssets(data.assets);
  const current = sum(
    scope.ops
      .filter((op) => op.type === 'buy' && op.date.slice(0, 4) === year)
      .map((op) => cashEffect(op, assets.get(op.assetId), data.rates).neg()),
  );
  const left = Math.max(0, monthsBetween(asOf, `${year}-12`));
  const plansSum = sum(scope.plans.filter((p) => p.active).map((p) => p.amount));
  const missing = atLeastZero(num(goal.target).minus(current));
  return {
    months,
    current,
    projected: current.plus(plansSum.times(left)),
    required: left ? missing.div(left) : missing,
  };
}

/** Everything the goals card and screen show for one goal. */
export function goalCalc(goal: Goal, data: GoalData, asOf: string): GoalResult {
  const scope = goalScope(goal, data, asOf);
  const mode: GoalMode = goal.type === 'contrib' ? 'date' : (goal.when ?? 'date');
  const target = num(goal.target);
  const monthly = num(goal.monthly);

  let current: Dec;
  let projected: Dec | null = null;
  let required: Dec | null = null;
  let reachIn: number | null = null;
  let yld = ZERO;
  let months = 0;
  const path: GoalPathPoint[] = [];

  if (goal.type === 'contrib') {
    ({ current, projected, required, months } = contributionGoal(goal, scope, data, asOf));
  } else {
    const i = monthlyRate(goal);
    let valueTarget = target;
    let pv: Dec;
    if (goal.type === 'income') {
      const goalYield = num(goal.yield).div(100);
      yld = goalYield.lte(0) ? (scope.yld.isZero() ? DEFAULT_YIELD : scope.yld) : goalYield;
      current = scope.income;
      valueTarget = target.div(yld);
      pv = scope.investedValue;
    } else if (goal.type === 'invested') {
      current = scope.invested;
      pv = current;
    } else {
      current = scope.value;
      pv = current;
    }
    const at = (m: number, pmt: Dec) => {
      const v = futureValue(i, pv, m, pmt);
      return goal.type === 'income' ? v.times(yld) : v;
    };
    const reached = valueTarget.minus(EPSILON);
    for (let m = 0; m <= MAX_MONTHS; m++) {
      if (futureValue(i, pv, m, monthly).gte(reached)) {
        reachIn = m;
        break;
      }
    }
    if (mode === 'date') {
      months = monthsToDeadline(asOf, goal.deadline);
      projected = at(months, monthly);
      const growth = dec(1).plus(i).pow(months);
      const gap = valueTarget.minus(pv.times(growth));
      if (!months) required = atLeastZero(gap);
      else if (i.isZero()) required = atLeastZero(gap.div(months));
      else required = atLeastZero(gap.times(i).div(growth.minus(1)));
    } else if (mode === 'eta') {
      months = reachIn != null ? Math.max(1, reachIn) : ETA_FALLBACK_MONTHS;
      projected = at(months, monthly);
    }
    if (mode !== 'none') {
      const step = Math.max(1, Math.ceil(months / MAX_PATH_STEPS));
      const point = (month: number): GoalPathPoint => ({
        month,
        planned: at(month, monthly),
        required: required ? at(month, required) : null,
      });
      for (let m = 0; m <= months; m += step) path.push(point(m));
      if (months % step) path.push(point(months));
    }
  }

  const progress = target.isZero() ? ZERO : current.div(target).clamp(0, 1);
  const done = current.gte(target);
  const onPlan =
    mode === 'date'
      ? projected != null && projected.gte(target.times(ON_TRACK_RATIO))
      : mode === 'eta'
        ? reachIn != null
        : true;
  const onTrack = done || onPlan;
  const etaMonth = reachIn != null ? monthKey(addMonths(asOf, reachIn)) : null;

  let status: GoalStatus = 'tracking';
  if (done) status = 'reached';
  else if (mode === 'date') status = onTrack ? 'on_track' : 'behind';
  else if (mode === 'eta') status = etaMonth ? 'eta' : 'no_contribution';

  return {
    scope,
    mode,
    current,
    target,
    projected,
    required,
    reachIn,
    etaMonth,
    months,
    progress,
    done,
    onTrack,
    status,
    yld,
    path,
    monthly,
  };
}
