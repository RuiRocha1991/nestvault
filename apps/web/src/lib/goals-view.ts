import type { GoalDto } from '@nestvault/services';

import { monthLabel } from './portfolios-view';

/** A goal as the API answers it (client components take the type from here). */
export type GoalView = GoalDto;
export type GoalType = GoalDto['type'];
export type GoalMode = GoalDto['mode'];

export const GOAL_TYPES: readonly GoalType[] = ['value', 'invested', 'income', 'contrib'];
export const GOAL_MODES: readonly GoalMode[] = ['date', 'eta', 'none'];

/** The colours a new goal cycles through (the data palette of the design system). */
export const GOAL_COLORS = [
  '#9D6BFF',
  '#2BC6B4',
  '#F2913D',
  '#5B8DEF',
  '#E356A8',
  '#C9A227',
  '#E5424D',
] as const;

/** `goal.result.status` → the key under `overview.goals.status` (`on_track` → `onTrack`). */
export const statusKey = (status: GoalDto['result']['status']): string =>
  status.replace(/_([a-z])/g, (_m, letter: string) => letter.toUpperCase());

/** `yyyy-mm` that is `months` after the month of `date` (`yyyy-mm-dd`). */
export function monthAfter(date: string, months: number): string {
  const [year, month] = date.split('-').map(Number) as [number, number];
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** `2028-02` → `Fev 2028`: the month name alone is ambiguous on a goal years away. */
export const monthYear = (month: string): string => `${monthLabel(month)} ${month.slice(0, 4)}`;

/** A goal in value terms: an income goal needs `target / yield` of capital. */
export function valueTarget(goal: GoalDto): number {
  const target = Number(goal.result.target);
  const yieldPct = Number(goal.result.yieldPct);
  return goal.type === 'income' && yieldPct > 0 ? target / (yieldPct / 100) : target;
}

export interface GoalChart {
  labels: string[];
  planned: number[];
  target: number[];
}

/** The projection of a goal as chart series; null when the goal has nothing to project. */
export function goalChart(goal: GoalDto, asOf: string): GoalChart | null {
  const { path } = goal.result;
  if (goal.type === 'contrib' || goal.result.mode === 'none' || path.length < 2) return null;
  const target = valueTarget(goal);
  // Years apart: a year is enough on the axis; a short horizon needs the month too.
  const years = (path[path.length - 1]?.month ?? 0) >= 36;
  return {
    labels: path.map((point) => {
      const month = monthAfter(asOf, point.month);
      return years ? month.slice(0, 4) : monthYear(month);
    }),
    planned: path.map((point) => Number(point.planned)),
    target: path.map(() => target),
  };
}

/** The `/ano` suffix of an income goal's amounts. */
export const perYear = (goal: GoalDto): boolean => goal.type === 'income';

// ---------------------------------------------------------------- the form

export interface GoalForm {
  name: string;
  color: string;
  type: GoalType;
  target: string;
  mode: GoalMode;
  deadline: string;
  monthly: string;
  rate: string;
  yield: string;
  includeSavings: boolean;
  portfolioIds: string[];
  /** `accountId` or `accountId|subAccountId`, the keys of the domain. */
  accounts: string[];
}

export const accountKey = (accountId: string, subAccountId?: string | null): string =>
  subAccountId ? `${accountId}|${subAccountId}` : accountId;

export function emptyGoalForm(defaults: Partial<GoalForm> & { deadline: string }): GoalForm {
  return {
    name: '',
    color: GOAL_COLORS[0],
    type: 'value',
    target: '',
    mode: 'date',
    monthly: '',
    rate: '6',
    yield: '',
    includeSavings: false,
    portfolioIds: [],
    accounts: [],
    ...defaults,
  };
}

/** `"6.000000"` → `"6"`, `"600.5000"` → `"600.5"`: the API pads decimals the user did not type. */
export function trimDecimal(value: string | null): string {
  if (value === null) return '';
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

export function goalToForm(goal: GoalDto, fallbackDeadline: string): GoalForm {
  return {
    name: goal.name,
    color: goal.color,
    type: goal.type,
    target: trimDecimal(goal.target),
    mode: goal.mode,
    deadline: goal.deadline ?? fallbackDeadline,
    monthly: trimDecimal(goal.monthly),
    rate: trimDecimal(goal.rate),
    yield: trimDecimal(goal.yield),
    includeSavings: goal.includeSavings,
    portfolioIds: [...goal.portfolioIds],
    accounts: goal.accounts.map((scope) => accountKey(scope.accountId, scope.subAccountId)),
  };
}

const decimal = (text: string): string => text.trim().replace(/\s/g, '').replace(',', '.');
const decimalOrNull = (text: string): string | null => decimal(text) || null;

/** True when the form has what the API needs: a name and a target above zero. */
export function isGoalFormComplete(form: GoalForm): boolean {
  const target = Number(decimal(form.target));
  return form.name.trim() !== '' && Number.isFinite(target) && target > 0;
}

/** The request body of a form (the type decides which fields count). */
export function goalFormBody(form: GoalForm): Record<string, unknown> {
  const mode = form.type === 'contrib' ? 'date' : form.mode;
  return {
    name: form.name.trim(),
    color: form.color,
    type: form.type,
    target: decimal(form.target),
    mode,
    deadline: mode === 'date' ? form.deadline : null,
    monthly: decimalOrNull(form.monthly),
    rate: decimalOrNull(form.rate),
    yield: decimalOrNull(form.yield),
    includeSavings: form.includeSavings,
    portfolioIds: form.portfolioIds,
    accounts: form.accounts.map((key) => {
      const [accountId, subAccountId] = key.split('|');
      return { accountId, subAccountId: subAccountId ?? null };
    }),
  };
}

/** Which fields a goal type shows (the prototype's `data-g` attributes). */
export function fieldsOf(type: GoalType, mode: GoalMode) {
  const projects = type === 'contrib' ? true : mode !== 'none';
  return {
    mode: type !== 'contrib',
    deadline: type === 'contrib' || mode === 'date',
    monthly: projects && (type === 'value' || type === 'income' || type === 'invested'),
    rate: projects && (type === 'value' || type === 'income'),
    yield: type === 'income',
    savings: type === 'value' || type === 'invested',
  };
}
