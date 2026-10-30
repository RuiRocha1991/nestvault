import { PLANS } from '@nestvault/db';
import { z } from 'zod';

const Limit = z.number().int().min(0).nullable();
const Used = z.number().int().min(0);

/** The plan of a pool with what it allows and what is used, for the UI (limits and upgrade prompts). */
export const PoolPlanDto = z.object({
  plan: z.enum(PLANS),
  /** `false` = billing is off and every pool is Pro. */
  billingEnabled: z.boolean(),
  /** `null` = unlimited. */
  limits: z.object({ accounts: Limit, portfolios: Limit, members: Limit }),
  usage: z.object({ accounts: Used, portfolios: Used, members: Used }),
  features: z.object({ real_estate: z.boolean(), ai_import: z.boolean() }),
});
export type PoolPlanDto = z.infer<typeof PoolPlanDto>;
