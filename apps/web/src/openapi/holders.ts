import {
  CreateHolderInput,
  HolderDto,
  HolderListDto,
  MergeHolderInput,
  MergePreviewDto,
  UpdateHolderInput,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Holders (PRD 04): the people of the household, with or without a login. Guards in the service:
// session, input validation, membership (404 for non-members), `accounts.write` (403) for writes,
// then `withPool` (RLS). Writes are audited (`holder.*`, target id only).

const PoolId = z.uuid();
const HolderId = z.uuid();

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/holders',
  operationId: 'listHolders',
  summary: 'People of the household',
  description:
    'Every member of the pool is listed (their holders are created on demand), then the people added by hand, oldest first. Any member may list. `member` is true while the linked person is still a member.',
  tags: ['Holders'],
  request: { params: z.object({ poolId: PoolId }) },
  responses: {
    200: { description: 'The holders of the pool', ...json(HolderListDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/holders',
  operationId: 'createHolder',
  summary: 'Add a person',
  description:
    'Needs `accounts.write`. Aliases are stored upper case without accents (at most 10, 3–60 characters each). Without a `color` the next unused colour of the series palette is used. `userId` links the person to a member of this pool (400 for anybody else); a member is at most one person (409). The body is strict: `poolId`, `id` or any other field answers 400.',
  tags: ['Holders'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(CreateHolderInput) },
  },
  responses: {
    201: { description: 'The new holder', ...json(HolderDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/holders/{id}',
  operationId: 'updateHolder',
  summary: 'Change a person',
  description:
    'Needs `accounts.write`. Fields left out stay; `userId: null` unlinks the member. A holder of another pool answers 404.',
  tags: ['Holders'],
  request: {
    params: z.object({ poolId: PoolId, id: HolderId }),
    body: { required: true, ...json(UpdateHolderInput) },
  },
  responses: {
    200: { description: 'The updated holder', ...json(HolderDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/holders/{id}',
  operationId: 'deleteHolder',
  summary: 'Remove a person',
  description:
    'Needs `accounts.write`. Answers 409 for a current member of the pool and while accounts or sub-accounts still name the person.',
  tags: ['Holders'],
  request: { params: z.object({ poolId: PoolId, id: HolderId }) },
  responses: {
    204: { description: 'Holder removed' },
    ...errorResponses(401, 403, 404, 409, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/holders/{id}/merge',
  operationId: 'previewHolderMerge',
  summary: 'Preview joining two people',
  description:
    'Needs `accounts.write`. Counts the accounts and sub-accounts that would move from the person `id` to `intoId` and lists the aliases that would be added. Changes nothing. 400 when both are the same person, 404 when either is not in this pool, 409 for the person of a current member.',
  tags: ['Holders'],
  request: {
    params: z.object({ poolId: PoolId, id: HolderId }),
    query: MergeHolderInput,
  },
  responses: {
    200: { description: 'What the merge would do', ...json(MergePreviewDto) },
    ...errorResponses(400, 401, 403, 404, 409, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/holders/{id}/merge',
  operationId: 'mergeHolder',
  summary: 'Join a person into another one',
  description:
    'Needs `accounts.write`. In one transaction every account, sub-account and alias of the person `id` moves to `intoId` (normalized, de-duplicated) and `id` is deleted; the target keeps its name. Nothing changes on failure. 400 for the same person or any extra field, 404 when either is not in this pool, 409 when `id` is the person of a current member or the result would have more than 10 aliases. The audit entry `holder.merged` names the target only.',
  tags: ['Holders'],
  request: {
    params: z.object({ poolId: PoolId, id: HolderId }),
    body: { required: true, ...json(MergeHolderInput) },
  },
  responses: {
    200: { description: 'The target person, with the merged aliases', ...json(HolderDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});
