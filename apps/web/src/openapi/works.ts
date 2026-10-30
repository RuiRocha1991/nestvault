import {
  CreatePaymentInput,
  CreateWorkInput,
  LinkTransactionInput,
  PaymentDto,
  UpcomingDto,
  UpdatePaymentInput,
  UpdateWorkInput,
  WorkDto,
  WorkListDto,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Works projects (PRD "Real estate and loans", Pro): a budget, a supplier and payment phases on a
// property. Guards in the service: session, input validation, membership (404 for non-members),
// `pool.read` for reads or `realestate.write` (owner, admin) for writes (403), then the Pro plan
// (403 `plan_limit`, `error.resource` `real_estate`, reads included). Then `withPool` (RLS).
// Writes are audited (`work.*`, target id; never amounts). Description and notes are user content.

const Pool = z.object({ poolId: z.uuid() });
const Params = Pool.extend({ id: z.uuid() });
const PaymentParams = Params.extend({ paymentId: z.uuid() });
const ListQuery = z.object({ propertyId: z.uuid().optional() });

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/works',
  operationId: 'listWorks',
  summary: 'Works projects of the pool',
  description:
    'Any member of a Pro pool may list. `propertyId` narrows it to one property. Each project comes with its phases and totals (budget, planned, paid, outstanding); `byProperty` adds them up per property.',
  tags: ['Works'],
  request: { params: Pool, query: ListQuery },
  responses: {
    200: { description: 'The list', ...json(WorkListDto) },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/works',
  operationId: 'createWork',
  summary: 'Open a works project',
  description:
    'Needs `realestate.write` (owner, admin) and the Pro plan. `propertyId` must belong to the pool; `plannedEnd` cannot be before `startDate`. The body is strict: `poolId` or any other field answers 400.',
  tags: ['Works'],
  request: { params: Pool, body: { required: true, ...json(CreateWorkInput) } },
  responses: {
    201: { description: 'Created', ...json(WorkDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/works/upcoming',
  operationId: 'listUpcomingWorkPayments',
  summary: 'Phases still to pay',
  description:
    'Any member of a Pro pool may read. The unpaid phases that have a planned date, grouped by the month they are planned for, oldest first (an overdue phase sits under its own month).',
  tags: ['Works'],
  request: { params: Pool },
  responses: {
    200: { description: 'The months', ...json(UpcomingDto) },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/works/{id}',
  operationId: 'getWork',
  summary: 'One works project',
  description: 'Any member of a Pro pool may read.',
  tags: ['Works'],
  request: { params: Params },
  responses: {
    200: { description: 'The item', ...json(WorkDto) },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/works/{id}',
  operationId: 'updateWork',
  summary: 'Change a works project',
  description:
    'Needs `realestate.write` and the Pro plan. Fields left out stay. The property of a project does not change.',
  tags: ['Works'],
  request: { params: Params, body: { required: true, ...json(UpdateWorkInput) } },
  responses: {
    200: { description: 'The item', ...json(WorkDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/works/{id}',
  operationId: 'deleteWork',
  summary: 'Delete a works project',
  description:
    'Needs `realestate.write` and the Pro plan. Its phases are deleted; a linked bank movement stays, with its category.',
  tags: ['Works'],
  request: { params: Params },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/works/{id}/payments',
  operationId: 'addWorkPayment',
  summary: 'Add a payment phase',
  description: 'Needs `realestate.write` and the Pro plan. A new phase is planned.',
  tags: ['Works'],
  request: { params: Params, body: { required: true, ...json(CreatePaymentInput) } },
  responses: {
    201: { description: 'Created', ...json(PaymentDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/works/{id}/payments/{paymentId}',
  operationId: 'updateWorkPayment',
  summary: 'Change a payment phase',
  description:
    'Needs `realestate.write` and the Pro plan. Setting `paidDate` marks the phase paid, clearing it plans it again; while a movement is linked the date follows the movement (400).',
  tags: ['Works'],
  request: { params: PaymentParams, body: { required: true, ...json(UpdatePaymentInput) } },
  responses: {
    200: { description: 'The item', ...json(PaymentDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/works/{id}/payments/{paymentId}',
  operationId: 'deleteWorkPayment',
  summary: 'Delete a payment phase',
  description: 'Needs `realestate.write` and the Pro plan.',
  tags: ['Works'],
  request: { params: PaymentParams },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/pools/{poolId}/works/{id}/payments/{paymentId}/transaction',
  operationId: 'linkWorkPayment',
  summary: 'Pay a phase with a bank debit',
  description:
    'Needs `realestate.write` and the Pro plan. The movement must be a debit of the pool that is not a transfer and does not pay another phase (409). The phase becomes paid on the movement’s date and the movement gets the global “works” category (marked manual, so rules and imports leave it).',
  tags: ['Works'],
  request: { params: PaymentParams, body: { required: true, ...json(LinkTransactionInput) } },
  responses: {
    200: { description: 'The item', ...json(PaymentDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/works/{id}/payments/{paymentId}/transaction',
  operationId: 'unlinkWorkPayment',
  summary: 'Take the link away',
  description:
    'Needs `realestate.write` and the Pro plan. The phase goes back to planned and loses its paid date; the movement keeps its category.',
  tags: ['Works'],
  request: { params: PaymentParams },
  responses: {
    200: { description: 'The item', ...json(PaymentDto) },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});
