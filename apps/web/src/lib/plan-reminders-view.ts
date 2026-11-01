import type { NotificationDto, PlanDto } from '@nestvault/services';

/** One plan reminder as the screens show it: the notification joined with its plan and asset. */
export interface PlanReminderView {
  id: string;
  planId: string;
  /** `yyyy-mm`: the month whose buy is missing. */
  period: string;
  /** The caller's own read state. */
  read: boolean;
  createdAt: string;
  ticker: string;
  /** The plan's amount (decimal string). */
  amount: string;
  portfolioId: string;
  /** A paused plan cannot be registered from the reminder. */
  active: boolean;
}

export interface PlanRemindersView {
  reminders: PlanReminderView[];
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Joins the open notifications with the plans and assets to build the reminders. The text is not
 * stored, so the UI builds it from these fields. A reminder whose plan is unknown (deleted
 * meanwhile) or whose period is missing is left out (`plan_reminder` is the only kind today): there is nothing to register.
 */
export function buildPlanReminders(
  notifications: readonly NotificationDto[],
  plans: readonly PlanDto[],
  tickers: ReadonlyMap<string, string>,
): PlanRemindersView {
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const reminders = notifications.flatMap((n): PlanReminderView[] => {
    const plan = n.planId ? byId.get(n.planId) : undefined;
    if (!plan || !n.period || !PERIOD.test(n.period)) return [];
    return [
      {
        id: n.id,
        planId: plan.id,
        period: n.period,
        read: n.read,
        createdAt: n.createdAt,
        ticker: tickers.get(plan.assetId) ?? '',
        amount: plan.amount,
        portfolioId: plan.portfolioId,
        active: plan.active,
      },
    ];
  });
  return { reminders };
}

const base = (poolId: string) => `/api/v1/pools/${encodeURIComponent(poolId)}`;

/** "Registar": the plan-run call for the month of the reminder (the server enforces `ops.write`). */
export function registerRequest(poolId: string, reminder: PlanReminderView) {
  return {
    path: `${base(poolId)}/plans/${encodeURIComponent(reminder.planId)}/run`,
    body: { month: reminder.period },
  };
}

/** "Marcar como lido": read state is personal, so the call only changes the caller's own. */
export function markReadRequest(poolId: string, reminder: PlanReminderView) {
  return {
    path: `${base(poolId)}/notifications/${encodeURIComponent(reminder.id)}/read`,
    body: {},
  };
}

/** `2026-10` becomes `10/2026`. */
export function formatPeriod(period: string): string {
  return `${period.slice(5, 7)}/${period.slice(0, 4)}`;
}

/** The reminders of one portfolio (all of them for "Todos"). */
export function remindersOf(
  reminders: readonly PlanReminderView[],
  portfolioId: string | null,
): PlanReminderView[] {
  return portfolioId ? reminders.filter((r) => r.portfolioId === portfolioId) : [...reminders];
}
