import {
  CostDto,
  CostListDto,
  CostPaymentDto,
  CostTotalsDto,
  CreateCostInput,
  LinkCostPaymentInput,
  UpcomingCostsDto,
  UpdateCostInput,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Recurring property costs (PRD "Real estate and loans", Pro): the IMI, the condominium and the
// insurances a property is paid for on their own. Guards in the service: session, input validation,
// membership (404 for non-members), `pool.read` for reads or `realestate.write` (owner, admin) for
// writes (403), then the Pro plan (403 `plan_limit`, `error.resource` `real_estate`, reads
// included). Then `withPool` (RLS). Writes are audited (`cost.*`, target id; never amounts). The
// name of a cost is user content.

const Pool = z.object({ poolId: z.uuid() });
const Params = Pool.extend({ id: z.uuid() });
const PaymentParams = Params.extend({ dueDate: z.iso.date() });
const ListQuery = z.object({ propertyId: z.uuid().optional() });
const UpcomingQuery = z.object({ months: z.coerce.number().int().min(1).max(24).optional() });
const TotalsQuery = z.object({
  propertyId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/property-costs',
  operationId: 'listPropertyCosts',
  summary: 'Recurring costs of the properties',
  description:
    'Any member of a Pro pool may list. `propertyId` narrows it to one property. Each cost comes with its annual amount and its next due date.',
  tags: ['Property costs'],
  request: { params: Pool, query: ListQuery },
  responses: {
    200: { description: 'The list', ...json(CostListDto) },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/property-costs',
  operationId: 'createPropertyCost',
  summary: 'Add a recurring cost to a property',
  description:
    'Needs `realestate.write` (owner, admin) and the Pro plan. `propertyId` and `accountId` must belong to the pool. `intervalMonths` is required for a `custom` periodicity and rejected otherwise; `other` costs need a `name`; `endDate` cannot be before `startDate`. The body is strict: `poolId` or any other field answers 400.',
  tags: ['Property costs'],
  request: { params: Pool, body: { required: true, ...json(CreateCostInput) } },
  responses: {
    201: { description: 'Created', ...json(CostDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/property-costs/upcoming',
  operationId: 'listUpcomingPropertyCosts',
  summary: 'Costs still expected, by month',
  description:
    'Any member of a Pro pool may read. The occurrences not yet paid from the start of this month for `months` months (default 12), grouped by month, oldest first: what feeds the month forecast. An insurance whose month already has the same insurance inside a loan installment of that property is left out, so it is never counted twice.',
  tags: ['Property costs'],
  request: { params: Pool, query: UpcomingQuery },
  responses: {
    200: { description: 'The months', ...json(UpcomingCostsDto) },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/property-costs/totals',
  operationId: 'getPropertyCostTotals',
  summary: 'What the properties cost in a period',
  description:
    'Any member of a Pro pool may read. Paid and expected occurrences by kind plus the insurances inside the loan installments of the period, counted once. Defaults to the current year; the period is at most 60 months.',
  tags: ['Property costs'],
  request: { params: Pool, query: TotalsQuery },
  responses: {
    200: { description: 'The totals and the occurrences', ...json(CostTotalsDto) },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/property-costs/{id}',
  operationId: 'getPropertyCost',
  summary: 'One recurring cost',
  description: 'Any member of a Pro pool may read.',
  tags: ['Property costs'],
  request: { params: Params },
  responses: {
    200: { description: 'The cost', ...json(CostDto) },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/property-costs/{id}',
  operationId: 'updatePropertyCost',
  summary: 'Change a recurring cost',
  description:
    'Needs `realestate.write` and the Pro plan. Fields left out stay; the property of a cost does not change. The body is strict.',
  tags: ['Property costs'],
  request: { params: Params, body: { required: true, ...json(UpdateCostInput) } },
  responses: {
    200: { description: 'The cost', ...json(CostDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/property-costs/{id}',
  operationId: 'deletePropertyCost',
  summary: 'Delete a recurring cost',
  description:
    'Needs `realestate.write` and the Pro plan. The occurrences it paid are removed with it; the bank movements stay.',
  tags: ['Property costs'],
  request: { params: Params },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/pools/{poolId}/property-costs/{id}/payments/{dueDate}',
  operationId: 'linkPropertyCostPayment',
  summary: 'Pay an occurrence with a bank debit',
  description:
    "Needs `realestate.write` and the Pro plan. `dueDate` must be one of the cost's due dates. The movement must be a debit of the pool that is not a transfer; it pays at most one occurrence (409 otherwise).",
  tags: ['Property costs'],
  request: { params: PaymentParams, body: { required: true, ...json(LinkCostPaymentInput) } },
  responses: {
    200: { description: 'The paid occurrence', ...json(CostPaymentDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/property-costs/{id}/payments/{dueDate}',
  operationId: 'unlinkPropertyCostPayment',
  summary: 'Take the link away',
  description: 'Needs `realestate.write` and the Pro plan. The occurrence is expected again.',
  tags: ['Property costs'],
  request: { params: PaymentParams },
  responses: {
    204: { description: 'Unlinked' },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});
