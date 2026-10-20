import { ExpensesSummaryDto, MovementTotalsDto } from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// The Despesas screen (NES-52): the month summary and the totals of a Movimentos filter. Both are
// read-only; guards in the service: session, membership (404 for non-members), `pool.read`.

const PoolId = z.uuid();
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/expenses/summary',
  operationId: 'getExpensesSummary',
  summary: 'Month summary of the expenses',
  description:
    'Any member may read. Income, expenses (net of refunds; transfers and investments are not expenses), invested, savings and savings rate of `month` (yyyy-mm, the current month by default), expenses by category (largest first) with the monthly budget, its progress and the difference against the average of the three previous months, and the last twelve months. All amounts are EUR decimal strings, computed by the same domain functions as the monthly review.',
  tags: ['Expenses'],
  request: { params: z.object({ poolId: PoolId }), query: z.object({ month: Month.optional() }) },
  responses: {
    200: { description: 'The summary', ...json(ExpensesSummaryDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/expenses/totals',
  operationId: 'getMovementTotals',
  summary: 'Totals of the movements a filter selects',
  description:
    'Any member may read. The filters are those of `GET /transactions` (`month`, `accountId`, `categoryId` or `none`, `kind`, `q` matched literally, `withNotes`), without sort and paging. Income, net expenses, money sent to investments, internal transfers (inflow side) and the number of movements without a category, in EUR; `rates` gives the EUR rate of each foreign currency in use.',
  tags: ['Expenses'],
  request: {
    params: z.object({ poolId: PoolId }),
    query: z.object({
      month: Month.optional(),
      accountId: z.uuid().optional(),
      categoryId: z.union([z.uuid(), z.literal('none')]).optional(),
      kind: z.enum(['expense', 'income', 'refund', 'transfer', 'invest']).optional(),
      q: z.string().min(1).max(100).optional(),
      withNotes: z.enum(['true', 'false']).optional(),
    }),
  },
  responses: {
    200: { description: 'The totals', ...json(MovementTotalsDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});
