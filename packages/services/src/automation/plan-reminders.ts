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

/** Whether a buy answers the plan for `period`: its own run, or a buy of the same asset by hand. */
function answers(plan: PlanRow, period: string, buys: readonly PlanBuy[]): boolean {
  return buys.some(
    (buy) =>
      (buy.planId === plan.id && buy.planPeriod === period) ||
      (buy.portfolioId === plan.portfolioId &&
        buy.assetId === plan.assetId &&
        buy.date.startsWith(period)),
  );
}

/**
 * Plan reminders of one pool (NES-68, lifecycle NES-150). For each active plan and each month of the
 * catch-up window (the current one and the two before it) whose plan day has passed without a buy
 * for that month, raises one reminder for that plan and month (never a second one, even after it
 * was resolved). A month only counts from the day the plan became active (`activated_at`), so a plan
 * created or switched on after its day is not late. A reminder is resolved when its buy is
 * registered or its plan was switched off or deleted, and expires when its month leaves the window.
 * `today` is `yyyy-mm-dd` in the household's time zone. Runs inside `withPool`.
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

  const stale = open.filter((reminder) => !reminder.period || reminder.period < first);
  outcome.expired = await notificationsRepo.resolve(
    tx,
    ctx,
    stale.map((reminder) => reminder.id),
  );
  const live = open.filter((reminder) => !stale.includes(reminder));

  const buys = await investmentOpsRepo.listBuysBetween(tx, ctx, `${first}-01`, monthEnd(current));
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const done = live
    .filter((reminder) => {
      const plan = reminder.planId ? byId.get(reminder.planId) : undefined;
      return !plan || !reminder.period || answers(plan, reminder.period, buys);
    })
    .map((reminder) => reminder.id);
  outcome.resolved = await notificationsRepo.resolve(tx, ctx, done);

  for (const plan of plans) {
    const activeSince = lisbonDay(plan.activatedAt);
    for (let back = REMINDER_WINDOW_MONTHS - 1; back >= 0; back -= 1) {
      const period = monthsBefore(current, back);
      const due = `${period}-${String(plan.day).padStart(2, '0')}`;
      // Not late yet, or the plan was not active when its day came.
      if (due >= today || due < activeSince || answers(plan, period, buys)) continue;
      if (await notificationsRepo.raisePlanReminder(tx, ctx, newId(), plan.id, period)) {
        outcome.raised += 1;
      }
    }
  }
  return outcome;
}
