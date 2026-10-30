import {
  CreatePropertyInput,
  CreateValuationInput,
  PropertyDto,
  PropertyListDto,
  UpdatePropertyInput,
  ValuationDto,
  ValuationListDto,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Real estate (PRD "Real estate and loans", Pro). Guards in the service: session, input validation,
// membership (404 for non-members), `pool.read` for reads or `realestate.write` (owner, admin) for
// writes (403), then the Pro plan: a Free pool (with `BILLING_ENABLED=true`) answers 403 with
// `error.code` `plan_limit` and `error.resource` `real_estate`, reads included. Then `withPool` (RLS).
// Writes are audited (`property.*`, target id; never amounts).

const PoolId = z.uuid();
const Params = z.object({ poolId: PoolId, id: z.uuid() });

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/properties',
  operationId: 'listProperties',
  summary: 'Properties of the pool',
  description:
    'Any member of a Pro pool may list. Each property comes with the itemized acquisition costs and their total, the loan amount (price minus down payment), its owners and the latest valuation.',
  tags: ['Real estate'],
  request: { params: z.object({ poolId: PoolId }) },
  responses: {
    200: { description: 'The list', ...json(PropertyListDto) },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/properties',
  operationId: 'createProperty',
  summary: 'Register a property',
  description:
    'Needs `realestate.write` (owner, admin) and the Pro plan. `holders` (at least one) are people of this pool with their ownership share in percent; the shares must add up to 100 and each person appears once. The down payment cannot be more than the price. `costs` itemizes the acquisition costs (deed, imt, stampDuty, registration, bankFees); what is left out is 0. The body is strict: `poolId` or any other field answers 400.',
  tags: ['Real estate'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(CreatePropertyInput) },
  },
  responses: {
    201: { description: 'Created', ...json(PropertyDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/properties/{id}',
  operationId: 'getProperty',
  summary: 'One property',
  description: 'Any member of a Pro pool may read.',
  tags: ['Real estate'],
  request: { params: Params },
  responses: {
    200: { description: 'The item', ...json(PropertyDto) },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/properties/{id}',
  operationId: 'updateProperty',
  summary: 'Change a property',
  description:
    'Needs `realestate.write` and the Pro plan. Fields left out stay; `costs` changes only the items given; `holders` replaces the owners (shares add up to 100).',
  tags: ['Real estate'],
  request: { params: Params, body: { required: true, ...json(UpdatePropertyInput) } },
  responses: {
    200: { description: 'The updated item', ...json(PropertyDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/properties/{id}',
  operationId: 'deleteProperty',
  summary: 'Delete a property',
  description: 'Needs `realestate.write` and the Pro plan. Its owners and valuations are deleted.',
  tags: ['Real estate'],
  request: { params: Params },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/properties/{id}/valuations',
  operationId: 'listPropertyValuations',
  summary: 'Valuations of a property',
  description:
    'Any member of a Pro pool may read. Newest first; the newest is the one net worth uses.',
  tags: ['Real estate'],
  request: { params: Params },
  responses: {
    200: { description: 'The valuations', ...json(ValuationListDto) },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/properties/{id}/valuations',
  operationId: 'addPropertyValuation',
  summary: 'Add a valuation',
  description:
    'Needs `realestate.write` and the Pro plan. `source` is manual (default), bank_appraisal or estimate. One valuation per property and day: a second one for the same day answers 409.',
  tags: ['Real estate'],
  request: { params: Params, body: { required: true, ...json(CreateValuationInput) } },
  responses: {
    201: { description: 'Added', ...json(ValuationDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/properties/{id}/valuations/{valuationId}',
  operationId: 'deletePropertyValuation',
  summary: 'Delete a valuation',
  description: 'Needs `realestate.write` and the Pro plan.',
  tags: ['Real estate'],
  request: { params: Params.extend({ valuationId: z.uuid() }) },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});
