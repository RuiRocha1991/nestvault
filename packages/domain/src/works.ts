import { daysBetween, monthKey } from './dates';
import { dec, roundCents, sum, toPlain, type DecInput } from './decimal';

/**
 * Works projects (PRD "Real estate and loans"): a budget and payment phases. What is paid, what is
 * still due and when comes from the phases; nothing derived is stored. Pure: decimal strings in and
 * out.
 */

export const WORK_PROJECT_STATUSES = ['planned', 'in_progress', 'done'] as const;
export type WorkProjectStatus = (typeof WORK_PROJECT_STATUSES)[number];

export interface WorkPhase {
  amount: DecInput;
  status: 'planned' | 'paid';
  plannedDate?: string | null;
  paidDate?: string | null;
}

export interface WorkTotals {
  /** What was agreed with the supplier. */
  budget: string;
  /** Sum of the phases entered, paid or not. */
  planned: string;
  paid: string;
  /** Budget not yet paid; 0 once paid covers it. */
  outstanding: string;
  /** Budget not yet split into phases; 0 when the phases cover it. */
  unplanned: string;
  phases: number;
  paidPhases: number;
}

const notBelowZero = (value: ReturnType<typeof dec>) => (value.lt(0) ? dec(0) : value);

/** Totals of one project. */
export function projectTotals(budget: DecInput, phases: readonly WorkPhase[]): WorkTotals {
  const planned = sum(phases.map((phase) => phase.amount));
  const paidPhases = phases.filter((phase) => phase.status === 'paid');
  const paid = sum(paidPhases.map((phase) => phase.amount));
  return {
    budget: toPlain(dec(budget)),
    planned: toPlain(planned),
    paid: toPlain(paid),
    outstanding: toPlain(notBelowZero(dec(budget).minus(paid))),
    unplanned: toPlain(notBelowZero(dec(budget).minus(planned))),
    phases: phases.length,
    paidPhases: paidPhases.length,
  };
}

export interface WorkProjectInput {
  budget: DecInput;
  status: WorkProjectStatus;
  phases: readonly WorkPhase[];
}

export interface PropertyWorkTotals {
  projects: number;
  byStatus: Record<WorkProjectStatus, number>;
  budget: string;
  paid: string;
  outstanding: string;
}

/** Totals of all the projects of a property: what the works add to what was invested. */
export function propertyWorkTotals(projects: readonly WorkProjectInput[]): PropertyWorkTotals {
  const totals = projects.map((project) => projectTotals(project.budget, project.phases));
  const byStatus: Record<WorkProjectStatus, number> = { planned: 0, in_progress: 0, done: 0 };
  for (const project of projects) byStatus[project.status] += 1;
  return {
    projects: projects.length,
    byStatus,
    budget: toPlain(sum(totals.map((total) => total.budget))),
    paid: toPlain(sum(totals.map((total) => total.paid))),
    outstanding: toPlain(sum(totals.map((total) => total.outstanding))),
  };
}

/** The deposit asked up front: the budget times the percentage, in cents. */
export function depositAmount(budget: DecInput, depositPct: DecInput): string {
  return toPlain(roundCents(dec(budget).times(depositPct).div(100)));
}

/** Days a phase was paid after it was planned; negative when paid early, `null` without both dates. */
export function paymentDelayDays(
  plannedDate: string | null | undefined,
  paidDate: string | null | undefined,
): number | null {
  if (!plannedDate || !paidDate) return null;
  return daysBetween(plannedDate, paidDate);
}

export interface UpcomingPhase<T> {
  phase: T;
  amount: DecInput;
  status: 'planned' | 'paid';
  plannedDate?: string | null;
}

export interface UpcomingMonth<T> {
  /** `yyyy-mm`. */
  month: string;
  amount: string;
  phases: T[];
}

/**
 * The phases still to pay, by the month they are planned for, oldest first. A phase without a
 * planned date has no month and is left out; one planned before `from` is overdue and comes first
 * under its own month.
 */
export function upcomingByMonth<T>(rows: readonly UpcomingPhase<T>[]): UpcomingMonth<T>[] {
  const months = new Map<string, { amount: ReturnType<typeof dec>; phases: T[] }>();
  for (const row of rows) {
    if (row.status === 'paid' || !row.plannedDate) continue;
    const key = monthKey(row.plannedDate);
    const entry = months.get(key) ?? { amount: dec(0), phases: [] };
    entry.amount = entry.amount.plus(row.amount);
    entry.phases.push(row.phase);
    months.set(key, entry);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, entry]) => ({ month, amount: toPlain(entry.amount), phases: entry.phases }));
}
