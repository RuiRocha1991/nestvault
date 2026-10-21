import { OverviewDto, OverviewQuery } from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// The overview screen (PRD FR — Overview dashboard) in one read. Guards in the service: session,
// query validation, membership (404 for non-members), `pool.read`, then `withPool` (RLS).

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/overview',
  operationId: 'getOverview',
  summary: 'Overview of the pool',
  description:
    'Any member may read. KPIs with sparklines (net worth, investments, passive income, month expenses), the net worth evolution (`range`: 6, 12, 24 months or all, at most 120), portfolios with value and return, this month’s expenses by category and the 12-month dividend forecast. All totals are in EUR, except each portfolio’s value (its own currency). Goals stay empty until the goals module exists.',
  tags: ['Overview'],
  request: { params: z.object({ poolId: z.uuid() }), query: OverviewQuery },
  responses: {
    200: { description: 'The overview', ...json(OverviewDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});
