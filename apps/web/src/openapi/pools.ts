import { CreatePoolInput, PoolSummaryDto, RenamePoolInput } from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Pools (households) of the signed-in user. Creating one needs no membership: the caller becomes
// its owner. Reading a pool the caller does not belong to answers 404, never 403.

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools',
  operationId: 'createPool',
  summary: 'Create a pool',
  description:
    'The name is trimmed and must have 1-60 characters without control characters. The caller becomes the `owner` and the only member. At most 10 pools per owner (409 beyond that). The pool, the membership and the `pool.created` audit entry are written in one transaction. Unknown fields (`role`, `id`, `ownerId`…) answer 400.',
  tags: ['Pools'],
  request: { body: { required: true, ...json(CreatePoolInput) } },
  responses: {
    201: { description: 'The new pool', ...json(PoolSummaryDto) },
    ...errorResponses(400, 401, 403, 409, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}',
  operationId: 'renamePool',
  summary: 'Rename a pool',
  description:
    'Owner only (`pool.rename`): admin, member and viewer answer 403, a non-member 404. The name is trimmed, 1-60 characters, no control characters. The body is strict: `id`, `createdAt`, `role` or any other field answers 400. The `pool.renamed` audit entry carries the pool id only, never the name.',
  tags: ['Pools'],
  request: {
    params: z.object({ poolId: z.uuid() }),
    body: { required: true, ...json(RenamePoolInput) },
  },
  responses: {
    200: { description: 'The pool after the change', ...json(PoolSummaryDto) },
    ...errorResponses(400, 401, 403, 404, 413, 429, 500),
  },
});
