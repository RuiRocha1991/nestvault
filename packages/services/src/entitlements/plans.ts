import type { Plan } from '@nestvault/db';

// The one place with plan numbers and features (ADR 0003). Feature code never writes a limit: it
// asks `assertWithinLimit` / `assertFeature`. `null` = unlimited.

export const LIMITED_RESOURCES = ['accounts', 'portfolios', 'members'] as const;
export type LimitedResource = (typeof LIMITED_RESOURCES)[number];

export const FEATURES = ['real_estate', 'ai_import'] as const;
export type Feature = (typeof FEATURES)[number];

export const PLAN_LIMITS: Record<Plan, Record<LimitedResource, number | null>> = {
  // `members: 1` is the owner: a Free pool takes no invites (holders without login are not members).
  free: { accounts: 3, portfolios: 2, members: 1 },
  pro: { accounts: null, portfolios: null, members: null },
};

export const PLAN_FEATURES: Record<Plan, Record<Feature, boolean>> = {
  free: { real_estate: false, ai_import: false },
  pro: { real_estate: true, ai_import: true },
};
