import {
  investmentOpsRepo,
  newId,
  notificationsRepo,
  plansRepo,
  type PlanBuy,
  type PlanRow,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';
import { monthEnd } from '@nestvault/domain';

import { lisbonDay } from './lisbon-day';

export interface PlanRemindersOutcome {
  /** Reminders created in this run. */
  raised: number;
  /** Reminders resolved in this run: the buy was registered, or the plan is gone or switched off. */
  resolved: number;
  /** Reminders closed for being older than the catch-up window, whatever happened to the plan. */
  expired: number;
}

/**
 * How many months a reminder lives: the current one and the two before it. A plan whose day passed
 * while the worker was down is caught up within this window; an open reminder of an older month is
 * expired (the buy can still be registered, the reminder just stops asking).
 */
export const REMINDER_WINDOW_MONTHS = 3;

/** `yyyy-mm` that is `back` months before `period`. */
export function monthsBefore(period: string, back: number): string {
  const index = Number(period.slice(0, 4)) * 12 + (Number(period.slice(5, 7)) - 1) - back;
  const year = Math.floor(index / 12);
  return `${String(year)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The date a plan is due in `period`: its day, or the last day of a shorter month. */
export function dueDate(period: string, day: number): string {
  const last = Number(monthEnd(period).slice(8, 10));
  return `${period}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/**
 * Whether a buy answers the plan for `period`: the buy its own run made for that month, or a buy of
 * the same asset in that month by hand. A manual buy from before the plan was activated is not an
 * answer (it was made for nothing the plan asked for).
 */
function answers(plan: PlanRow, period: string, buys: readonly PlanBuy[]): boolean {
  const activeSince = lisbonDay(plan.activatedAt);
  return buys.some(
    (buy) =>
      (buy.planId === plan.id && buy.planPeriod === period) ||
      (buy.portfolioId === plan.portfolioId &&
        buy.assetId === plan.assetId &&
        buy.date.startsWith(period) &&
        buy.date >= activeSince),
  );
}

/**
 * Plan reminders of one pool (NES-68, lifecycle NES-150). For each active plan and each month of the
 * catch-up window (the current one and the two before it) whose plan day has passed without a buy
 * for that month, raises one reminder for that plan and month (never a second one, even after it
 * was resolved). A month only counts from the day the plan became active (`activated_at`), so a plan
 * created or switched on after its day is not late. A reminder is resolved when its buy is
 * registered or its plan was switched off or deleted; one still open when its month leaves the
 * window expires. Answered and orphaned reminders are resolved first, so only the really unanswered
 * ones count as expired. `today` is `yyyy-mm-dd` in the household's time zone. Runs inside `withPool`.
 */
export async function remindPlansInPool(
  tx: PoolTx,
  ctx: PoolContext,
  today: string,
): Promise<PlanRemindersOutcome> {
  const current = today.slice(0, 7);
  const first = monthsBefore(current, REMINDER_WINDOW_MONTHS - 1);
  const outcome: PlanRemindersOutcome = { raised: 0, resolved: 0, expired: 0 };

  const [plans, open] = await Promise.all([
    plansRepo.listActive(tx, ctx),
    notificationsRepo.listOpenPlanReminders(tx, ctx),
  ]);

  // Buys from the oldest open reminder on, so an old reminder can still be found answered.
  const oldest = open.reduce((min, n) => (n.period && n.period < min ? n.period : min), first);
  const buys = await investmentOpsRepo.listBuysBetween(tx, ctx, `${oldest}-01`, monthEnd(current));
  const byId = new Map(plans.map((plan) => [plan.id, plan]));

  const resolve: string[] = [];
  const expire: string[] = [];
  for (const reminder of open) {
    const plan = reminder.planId ? byId.get(reminder.planId) : undefined;
    if (!plan || !reminder.period || answers(plan, reminder.period, buys))
      resolve.push(reminder.id);
    else if (reminder.period < first) expire.push(reminder.id);
  }
  outcome.resolved = await notificationsRepo.resolve(tx, ctx, resolve);
  outcome.expired = await notificationsRepo.resolve(tx, ctx, expire);

  for (const plan of plans) {
    const activeSince = lisbonDay(plan.activatedAt);
    for (let back = REMINDER_WINDOW_MONTHS - 1; back >= 0; back -= 1) {
      const period = monthsBefore(current, back);
      const due = dueDate(period, plan.day);
      // Not late yet, or the plan was not active when its day came.
      if (due >= today || due < activeSince || answers(plan, period, buys)) continue;
      if (await notificationsRepo.raisePlanReminder(tx, ctx, newId(), plan.id, period)) {
        outcome.raised += 1;
      }
    }
  }
  return outcome;
}
