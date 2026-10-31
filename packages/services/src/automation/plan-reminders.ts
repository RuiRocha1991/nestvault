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
 * Plan reminders of one pool (NES-68). For each active plan whose day of the month has passed
 * without a buy for the month, raises one reminder for that plan and month (never a second one, even
 * after it was resolved). A reminder is resolved when its buy is registered or its plan was
 * switched off. `today` is `yyyy-mm-dd` in the household's time zone. Runs inside `withPool`.
 */
export async function remindPlansInPool(
  tx: PoolTx,
  ctx: PoolContext,
  today: string,
): Promise<PlanRemindersOutcome> {
  const period = today.slice(0, 7);
  const dayOfMonth = Number(today.slice(8, 10));
  const outcome: PlanRemindersOutcome = { raised: 0, resolved: 0 };

  const [plans, open] = await Promise.all([
    plansRepo.listActive(tx, ctx),
    notificationsRepo.listOpenPlanReminders(tx, ctx),
  ]);
  const oldest = open.reduce((min, n) => (n.period && n.period < min ? n.period : min), period);
  const buys = await investmentOpsRepo.listBuysBetween(tx, ctx, `${oldest}-01`, monthEnd(period));

  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const done = open
    .filter((reminder) => {
      const plan = reminder.planId ? byId.get(reminder.planId) : undefined;
      return !plan || !reminder.period || answers(plan, reminder.period, buys);
    })
    .map((reminder) => reminder.id);
  outcome.resolved = await notificationsRepo.resolve(tx, ctx, done);

  for (const plan of plans) {
    if (plan.day >= dayOfMonth || answers(plan, period, buys)) continue;
    // A plan created or switched on after this month's plan day was never due this month.
    const due = `${period}-${String(plan.day).padStart(2, '0')}`;
    if (due < lisbonDay(plan.updatedAt)) continue;
    if (await notificationsRepo.raisePlanReminder(tx, ctx, newId(), plan.id, period)) {
      outcome.raised += 1;
    }
  }
  return outcome;
}
