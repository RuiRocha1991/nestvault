# ADR 0004 — Global category catalogue plus pool-specific categories

- **Status:** Accepted. Supersedes "seed default categories per pool" (NES-26).
- **Date:** 2026-10-11

## Decision

- Default categories (Habitação, Supermercado, …, Investimento) are a **global catalogue** shared
  by every pool: rows in `categories` with `pool_id IS NULL`, `system_key` (stable English key,
  e.g. `groceries`) and the display name from i18n (`categories.groceries`). Managed only by the app
  admin (migration/seed), never through pool APIs.
- Categories a user creates belong to **their pool only** (`pool_id` set), as before.
- Per-pool settings for any category (global or own) in `pool_category_settings(pool_id,
  category_id, monthly_budget, color_override, hidden)`; budgets are always per pool.
- RLS on `categories`: `USING (pool_id IS NULL OR pool_id = current_setting('app.pool_id')::uuid)`,
  `WITH CHECK (pool_id = current_setting('app.pool_id')::uuid)` — pools read global rows but can only
  write their own.
- Rules may reference global or own categories; global keyword rules (e.g. `REPSOL` → fuel) can be
  offered as suggestions, never applied silently.
- Deleting a pool category re-assigns its transactions to a chosen category; global categories
  cannot be deleted by pools, only hidden.
