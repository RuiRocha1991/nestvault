import { PoolPlanDto } from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Plan and limits (ADR 0003). Guards in the service: session, membership (404 for non-members),
// `pool.read`. Nothing is written here: the plan comes from the pool's subscription, and while
// `BILLING_ENABLED=false` every pool is Pro.

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/plan',
  operationId: 'getPoolPlan',
  summary: 'Plan, limits and usage of the pool',
  description:
    'Any member may read. `limits` has `null` for unlimited. When a create is refused by the plan, that endpoint answers 403 with `error.code` `plan_limit` plus `error.resource` and `error.limit` (`null` for a Pro feature); the UI shows the upgrade prompt.',
  tags: ['Plan'],
  request: { params: z.object({ poolId: z.uuid() }) },
  responses: {
    200: { description: 'The plan', ...json(PoolPlanDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});
