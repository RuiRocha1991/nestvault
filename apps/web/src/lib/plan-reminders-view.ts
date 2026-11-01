import type { AssetDto, NotificationDto, PlanDto, PortfolioDto } from '@nestvault/services';

/** One plan reminder as the screens show it: the notification joined with its plan and asset. */
export interface PlanReminderView {
  id: string;
  planId: string;
  /** `yyyy-mm`: the month whose buy is missing. */
  period: string;
  /** The caller's own read state. */
  read: boolean;
  ticker: string;
  assetType: string;
  /** The plan's amount, in the asset's currency. */
  amount: string;
  currency: string;
  /** Day of the month the plan buys on. */
  day: number;
  portfolioId: string;
  portfolioName: string;
  /** A paused plan cannot be registered from the reminder. */
  active: boolean;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Joins the open notifications with the plans, assets and portfolios the caller already has. The
 * text is not stored, so the UI builds it from these fields. A reminder is left out when there is
 * nothing to register or nothing to show: its plan, asset or portfolio is unknown (deleted
 * meanwhile) or its period is missing.
 */
export function buildPlanReminders(
  notifications: readonly NotificationDto[],
  plans: readonly Pick<PlanDto, 'id' | 'assetId' | 'portfolioId' | 'amount' | 'day' | 'active'>[],
  assets: readonly Pick<AssetDto, 'id' | 'ticker' | 'type' | 'currency'>[],
  portfolios: readonly Pick<PortfolioDto, 'id' | 'name'>[],
): PlanReminderView[] {
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const portfolioById = new Map(portfolios.map((portfolio) => [portfolio.id, portfolio]));
  // `plan_reminder` is the only notification kind today.
  return notifications.flatMap((n): PlanReminderView[] => {
    const plan = n.planId ? planById.get(n.planId) : undefined;
    const asset = plan && assetById.get(plan.assetId);
    const portfolio = plan && portfolioById.get(plan.portfolioId);
    if (!plan || !asset || !portfolio || !asset.ticker || !n.period || !PERIOD.test(n.period)) {
      return [];
    }
    return [
      {
        id: n.id,
        planId: plan.id,
        period: n.period,
        read: n.read,
        ticker: asset.ticker,
        assetType: asset.type,
        amount: plan.amount,
        currency: asset.currency,
        day: plan.day,
        portfolioId: plan.portfolioId,
        portfolioName: portfolio.name,
        active: plan.active,
      },
    ];
  });
}

const base = (poolId: string) => `/api/v1/pools/${encodeURIComponent(poolId)}`;

/** "Registar compra": the plan-run call for the month of the reminder (the server enforces `ops.write`). */
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
