import { CreatePoolInput, PoolSummaryDto } from '@nestvault/services';

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
