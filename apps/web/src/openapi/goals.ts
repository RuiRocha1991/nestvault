import { CreateGoalInput, GoalDto, GoalListDto, UpdateGoalInput } from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Goals (PRD 04). Guards in the service: session, input validation, membership (404 for
// non-members), `pool.read` for reads or `goals.write` (owner, admin) for writes (403), then
// `withPool` (RLS). Writes are audited (`goal.*`, target id; never amounts).

const PoolId = z.uuid();

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/goals',
  operationId: 'listGoals',
  summary: 'Goals of the pool',
  description:
    'Any member may list. Each goal comes with its calculation of today (`result`): current value, projection, required monthly contribution, status and the projection path.',
  tags: ['Goals'],
  request: { params: z.object({ poolId: PoolId }) },
  responses: {
    200: { description: 'The list', ...json(GoalListDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/goals',
  operationId: 'createGoal',
  summary: 'Create',
  description:
    'Needs `goals.write` (owner, admin). `type` is value, invested, income or contrib; `mode` is date (needs `deadline`), eta or none (a `contrib` goal always uses a date). `portfolioIds` and `accounts` (an account, or one of its sub-accounts) say what the goal counts; none means everything, and when accounts are given the portfolios are ignored. The body is strict: `poolId` or any other field answers 400.',
  tags: ['Goals'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(CreateGoalInput) },
  },
  responses: {
    201: { description: 'Created', ...json(GoalDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/goals/{id}',
  operationId: 'getGoal',
  summary: 'One',
  description: 'Any member may read.',
  tags: ['Goals'],
  request: { params: z.object({ poolId: PoolId, id: z.uuid() }) },
  responses: {
    200: { description: 'The item', ...json(GoalDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/goals/{id}',
  operationId: 'updateGoal',
  summary: 'Change',
  description:
    'Needs `goals.write`. Fields left out stay; `portfolioIds` or `accounts` replace what the goal counts.',
  tags: ['Goals'],
  request: {
    params: z.object({ poolId: PoolId, id: z.uuid() }),
    body: { required: true, ...json(UpdateGoalInput) },
  },
  responses: {
    200: { description: 'The updated item', ...json(GoalDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/goals/{id}',
  operationId: 'deleteGoal',
  summary: 'Delete',
  description: 'Needs `goals.write`. The goal and what it counts are deleted.',
  tags: ['Goals'],
  request: { params: z.object({ poolId: PoolId, id: z.uuid() }) },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});
