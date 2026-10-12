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

## Addendum (2026-10-12) — Free preview of Pro modules

Free pools can **open** Pro modules (real estate and loans today), but only see **fictional demo
data** in read-only mode instead of an empty state or a 403 page.

- The demo data is static and shipped with the app (never written to the pool's database, never
  counted in net worth, never exported). Pages show a "dados de exemplo" banner and an `EXEMPLO` tag.
- Every action control (add, edit, import, delete, simulate-and-save…) is rendered normally with a
  lock icon and, when clicked, **always opens the "Plano Pro" dialog** instead of calling the API.
- The dialog is UI only. The server rule is unchanged: services still call
  `assertFeature(ctx, 'real_estate')` and return `PlanLimitError` (403, code `plan_limit`), so the
  preview cannot be used to write real data.
- Dialog variants: owner (**Ativar Pro**), non-owner member (**Só o proprietário pode ativar o Pro**,
  with "Avisar o proprietário"), and the numeric limit variant (**Limite do plano Free atingido**,
  e.g. 3 of 3 accounts).
- Navigation shows a `PRO` tag next to the module for Free pools.
- Mockups: `design/mockups/*/33…`, `34…`, `35…`, `36…`, `modal-37…39…`.
