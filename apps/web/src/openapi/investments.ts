import {
  CreateOpInput,
  CreatePlanInput,
  CreatePortfolioInput,
  DeletePortfolioQuery,
  ListOpsQuery,
  ListPlansQuery,
  OpDto,
  OpListDto,
  PlanDto,
  PlanListDto,
  PlanRunDto,
  PortfolioDto,
  PortfolioListDto,
  PortfolioSummaryDto,
  RunPlanInput,
  SummaryQuery,
  UpdateOpInput,
  UpdatePlanInput,
  UpdatePortfolioInput,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Portfolios, investment operations and regular plans (PRD 04). Guards in the service: session,
// input validation, membership (404 for non-members), then `portfolios.write` (portfolios and
// plans, owner and admin) or `ops.write` (operations and plan runs, members too) for writes (403),
// then `withPool` (RLS). Writes are audited (`portfolio.*`, `op.*`, `plan.*`, target id; never
// amounts or notes).

const PoolId = z.uuid();

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/portfolios',
  operationId: 'listPortfolios',
  summary: 'Portfolios of the pool',
  description: 'Any member may list.',
  tags: ['Portfolios'],
  request: { params: z.object({ poolId: PoolId }) },
  responses: {
    200: { description: 'The list', ...json(PortfolioListDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/portfolios',
  operationId: 'createPortfolio',
  summary: 'Create',
  description:
    'Needs `portfolios.write` (owner, admin). The name is unique inside the pool (409). `targets` maps a label to a percentage (0-100). The body is strict: `poolId` or any other field answers 400.',
  tags: ['Portfolios'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(CreatePortfolioInput) },
  },
  responses: {
    201: { description: 'Created', ...json(PortfolioDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/portfolios/{id}',
  operationId: 'getPortfolio',
  summary: 'One',
  description: 'Any member may read.',
  tags: ['Portfolios'],
  request: { params: z.object({ poolId: PoolId, id: z.uuid() }) },
  responses: {
    200: { description: 'The item', ...json(PortfolioDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/portfolios/{id}',
  operationId: 'updatePortfolio',
  summary: 'Change',
  description: 'Needs `portfolios.write`. Fields left out stay.',
  tags: ['Portfolios'],
  request: {
    params: z.object({ poolId: PoolId, id: z.uuid() }),
    body: { required: true, ...json(UpdatePortfolioInput) },
  },
  responses: {
    200: { description: 'The updated item', ...json(PortfolioDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/portfolios/{id}',
  operationId: 'deletePortfolio',
  summary: 'Delete',
  description:
    'Needs `portfolios.write`. A portfolio with operations or plans needs `moveTo` (another portfolio, the operations and plans go there) or `deleteOps=true` (the operations and plans are deleted); without one it answers 409. Accounts linked to it are unlinked.',
  tags: ['Portfolios'],
  request: { params: z.object({ poolId: PoolId, id: z.uuid() }), query: DeletePortfolioQuery },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 409, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/portfolios/summary',
  operationId: 'getPortfolioSummary',
  summary: 'Summary of one portfolio or of all',
  description:
    'Any member may read. The result of the domain `portfolioSummary` (value, cost, gain, dividends, realized, cash, profit, IRR) as of `asOf` (today by default), by currency and in EUR. `portfolioId` narrows to one portfolio (another pool’s answers 404).',
  tags: ['Portfolios'],
  request: { params: z.object({ poolId: PoolId }), query: SummaryQuery },
  responses: {
    200: { description: 'The summary', ...json(PortfolioSummaryDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/ops',
  operationId: 'listOps',
  summary: 'Ops of the pool',
  description: 'Any member may list.',
  tags: ['Operations'],
  request: { params: z.object({ poolId: PoolId }), query: ListOpsQuery },
  responses: {
    200: { description: 'The list', ...json(OpListDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/ops',
  operationId: 'createOp',
  summary: 'Create',
  description:
    'Needs `ops.write` (owner, admin, member). A buy or sell needs `qty` above zero and a `price`; a dividend needs `amount` (net), with optional `gross` and `tax` (negative for a refund). The account must be a brokerage or checking account and the sub-account one of that account (400). Notes are user content. The body is strict: `extId`, `planId`, `poolId` and any other field answer 400.',
  tags: ['Operations'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(CreateOpInput) },
  },
  responses: {
    201: { description: 'Created', ...json(OpDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/ops/{id}',
  operationId: 'getOp',
  summary: 'One',
  description: 'Any member may read.',
  tags: ['Operations'],
  request: { params: z.object({ poolId: PoolId, id: z.uuid() }) },
  responses: {
    200: { description: 'The item', ...json(OpDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/ops/{id}',
  operationId: 'updateOp',
  summary: 'Change',
  description: 'Needs `ops.write`. Fields left out stay; the result is validated as a whole.',
  tags: ['Operations'],
  request: {
    params: z.object({ poolId: PoolId, id: z.uuid() }),
    body: { required: true, ...json(UpdateOpInput) },
  },
  responses: {
    200: { description: 'The updated item', ...json(OpDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/ops/{id}',
  operationId: 'deleteOp',
  summary: 'Delete',
  description: 'Needs `ops.write`.',
  tags: ['Operations'],
  request: { params: z.object({ poolId: PoolId, id: z.uuid() }) },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 409, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/plans',
  operationId: 'listPlans',
  summary: 'Plans of the pool',
  description: 'Any member may list.',
  tags: ['Plans'],
  request: { params: z.object({ poolId: PoolId }), query: ListPlansQuery },
  responses: {
    200: { description: 'The list', ...json(PlanListDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/plans',
  operationId: 'createPlan',
  summary: 'Create',
  description:
    'Needs `portfolios.write`. A regular buy of `amount` in the asset on `day` (1-28) of every month.',
  tags: ['Plans'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(CreatePlanInput) },
  },
  responses: {
    201: { description: 'Created', ...json(PlanDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/plans/{id}',
  operationId: 'getPlan',
  summary: 'One',
  description: 'Any member may read.',
  tags: ['Plans'],
  request: { params: z.object({ poolId: PoolId, id: z.uuid() }) },
  responses: {
    200: { description: 'The item', ...json(PlanDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/plans/{id}',
  operationId: 'updatePlan',
  summary: 'Change',
  description: 'Needs `portfolios.write`. Fields left out stay.',
  tags: ['Plans'],
  request: {
    params: z.object({ poolId: PoolId, id: z.uuid() }),
    body: { required: true, ...json(UpdatePlanInput) },
  },
  responses: {
    200: { description: 'The updated item', ...json(PlanDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/plans/{id}',
  operationId: 'deletePlan',
  summary: 'Delete',
  description: 'Needs `portfolios.write`. The buys the plan created stay, without the link.',
  tags: ['Plans'],
  request: { params: z.object({ poolId: PoolId, id: z.uuid() }) },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 409, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/plans/{id}/run',
  operationId: 'runPlan',
  summary: 'Register the plan’s buy for a month',
  description:
    'Needs `ops.write`. Creates the buy of the month (`month`, yyyy-mm; the current one by default) at the asset’s latest price, dated on the plan’s day (never in the future). Idempotent per month: a second run creates nothing and answers 200 with `created: false` and the existing buy. An inactive plan answers 409; an asset without a price answers 400.',
  tags: ['Plans'],
  request: {
    params: z.object({ poolId: PoolId, id: z.uuid() }),
    body: { required: true, ...json(RunPlanInput) },
  },
  responses: {
    200: { description: 'Already registered for the month', ...json(PlanRunDto) },
    201: { description: 'The buy was created', ...json(PlanRunDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});
