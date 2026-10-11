# ADR 0003 — Free and Pro plans via entitlements per pool

- **Status:** Accepted (design). Entitlements module in phase 2; billing (Stripe) later.
- **Date:** 2026-10-11

## Decision

- The plan belongs to the **pool**; the owner pays; every member benefits.
- **Free**: up to **3 accounts**, **2 portfolios**, **1 member** (the owner; no invites — holders
  without login are allowed), **no real estate / loans**. **Pro**: no limits, real estate and loans,
  AI-assisted import.
- `packages/services/src/entitlements`: `planOf(ctx)`, `assertWithinLimit(ctx, 'accounts' | 'portfolios'
  | 'members' | 'properties')` and `assertFeature(ctx, 'real_estate' | 'ai_import')`, called in
  services next to `can()`. Counting + insert run in the same transaction with a per-pool advisory
  lock, so two concurrent requests cannot exceed the limit. Limit errors are a typed
  `PlanLimitError` (HTTP 403 with code `plan_limit`) and the UI shows an upgrade prompt.
- Limits live in one config map (`plans.ts`), not scattered in feature code.
- Identity DB table `pool_subscriptions(pool_id, plan, status, provider, provider_customer_id,
  provider_subscription_id, current_period_end, cancel_at)`; no row = Free.
- `BILLING_ENABLED=false` (default, dev and family use): every pool is treated as Pro.
- **Downgrade never deletes data**: items above the limit become read-only; new items are blocked
  until within the limit or upgraded. Extra members keep read-only access until removed.
- Billing later: Stripe Billing + Customer Portal + webhooks (signature verified, idempotent),
  Stripe Tax for VAT; no card data ever touches our servers.
