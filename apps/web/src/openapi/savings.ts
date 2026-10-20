import {
  CreateDepositInput,
  CreateInterestInput,
  CreateProductInput,
  DepositDto,
  DepositListDto,
  DepositScheduleDto,
  InterestEntryDto,
  InterestListDto,
  ListInterestQuery,
  ProductDto,
  ProductListDto,
  ScheduleQuery,
  UpdateDepositInput,
  UpdateProductInput,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Savings products, term deposits and manual interest (PRD 04). Guards in the service: session,
// input validation, membership (404 for non-members), then `accounts.write` for writes (403), then
// `withPool` (RLS). Writes are audited (`product.*`, `deposit.*`, `interest.*`, target id; never
// amounts or notes). Rates and taxes are percentages between 0 and 100 with up to 4 decimals.

const PoolId = z.uuid();
const pool = z.object({ poolId: PoolId });
const item = z.object({ poolId: PoolId, id: z.uuid() });

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/products',
  operationId: 'listProducts',
  summary: 'Savings products with their deposits’ capital and weighted rate',
  description:
    'Any member may list. Each product carries `depositsCount`, the total `capital` of its deposits and the `averageRate` weighted by capital (null without deposits).',
  tags: ['Products'],
  request: { params: pool },
  responses: {
    200: { description: 'The list', ...json(ProductListDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/products',
  operationId: 'createProduct',
  summary: 'Create',
  description:
    'Needs `accounts.write`. The name is unique inside the pool (409). `payN`/`payU` and `termN`/`termU` come as a number with its unit (`m` months, `d` days) or not at all; without `tax` the pool’s default applies. `payToAccountId` receives the interest (none: it capitalizes), `fundFromAccountId` funds the deposit; neither can be a term-deposit account.',
  tags: ['Products'],
  request: { params: pool, body: { required: true, ...json(CreateProductInput) } },
  responses: {
    201: { description: 'Created', ...json(ProductDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/products/{id}',
  operationId: 'getProduct',
  summary: 'One',
  description: 'Any member may read.',
  tags: ['Products'],
  request: { params: item },
  responses: {
    200: { description: 'The item', ...json(ProductDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/products/{id}',
  operationId: 'updateProduct',
  summary: 'Change',
  description:
    'Needs `accounts.write`. Fields left out stay. Deposits already made keep the terms they were created with.',
  tags: ['Products'],
  request: { params: item, body: { required: true, ...json(UpdateProductInput) } },
  responses: {
    200: { description: 'The updated item', ...json(ProductDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/products/{id}',
  operationId: 'deleteProduct',
  summary: 'Delete',
  description: 'Needs `accounts.write`. 409 while a deposit was made with the product.',
  tags: ['Products'],
  request: { params: item },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 409, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/deposits',
  operationId: 'listDeposits',
  summary: 'Term deposits of the pool',
  description: 'Any member may list.',
  tags: ['Deposits'],
  request: { params: pool },
  responses: {
    200: { description: 'The list', ...json(DepositListDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/deposits',
  operationId: 'createDeposit',
  summary: 'Create the deposit of a term-deposit account',
  description:
    'Needs `accounts.write`. One deposit per account (409). With `productId`, every field left out (`rate`, periods, `tax`, accounts) is filled from the product and what is sent overrides it (`null` means none); without a product `rate` is required. The terms are stored on the deposit, so later changes to the product do not touch it.',
  tags: ['Deposits'],
  request: { params: pool, body: { required: true, ...json(CreateDepositInput) } },
  responses: {
    201: { description: 'Created', ...json(DepositDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/deposits/{id}',
  operationId: 'getDeposit',
  summary: 'One',
  description: 'Any member may read.',
  tags: ['Deposits'],
  request: { params: item },
  responses: {
    200: { description: 'The item', ...json(DepositDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/deposits/{id}',
  operationId: 'updateDeposit',
  summary: 'Change',
  description: 'Needs `accounts.write`. Fields left out stay; the account cannot change.',
  tags: ['Deposits'],
  request: { params: item, body: { required: true, ...json(UpdateDepositInput) } },
  responses: {
    200: { description: 'The updated item', ...json(DepositDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/deposits/{id}',
  operationId: 'deleteDeposit',
  summary: 'Delete',
  description: 'Needs `accounts.write`. The account stays.',
  tags: ['Deposits'],
  request: { params: item },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/deposits/{id}/schedule',
  operationId: 'getDepositSchedule',
  summary: 'Schedule, next payment, maturity and value',
  description:
    'Any member may read. `periods` are the interest payments (base × rate × days / 365, rounded to cents, net of tax), computed by the domain’s `depositSchedule`; `value` is the domain’s `depositValue` on `asOf` (today by default).',
  tags: ['Deposits'],
  request: { params: item, query: ScheduleQuery },
  responses: {
    200: { description: 'The schedule', ...json(DepositScheduleDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/interest',
  operationId: 'listInterest',
  summary: 'Manual interest entries, newest first',
  description: 'Any member may list; `accountId` narrows to one account.',
  tags: ['Interest'],
  request: { params: pool, query: ListInterestQuery },
  responses: {
    200: { description: 'The list', ...json(InterestListDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/interest',
  operationId: 'createInterest',
  summary: 'Record interest received',
  description:
    'Needs `accounts.write`. `amount` is the net interest, above zero, in the account’s currency. Only savings accounts and term deposits without a payment schedule take entries (a scheduled deposit answers 409).',
  tags: ['Interest'],
  request: { params: pool, body: { required: true, ...json(CreateInterestInput) } },
  responses: {
    201: { description: 'Created', ...json(InterestEntryDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/interest/{id}',
  operationId: 'deleteInterest',
  summary: 'Delete',
  description: 'Needs `accounts.write`.',
  tags: ['Interest'],
  request: { params: item },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});
