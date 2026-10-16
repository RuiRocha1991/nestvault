import {
  MemberListDto,
  MemberRoleDto,
  TransferOwnershipDto,
  TransferOwnershipInput,
  UpdateMemberRoleInput,
} from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Members of a pool (PRD 01): list, change role, remove, leave and hand the pool over. Guards in the
// services: session, input validation, membership (404 for non-members), permission (403), then a
// transaction that locks the pool's membership rows so a pool never ends up without an owner.
// Role changes and removals end the member's sessions in the pool; every action is audited.

const PoolId = z.uuid();
const UserId = z.uuid();

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/members',
  operationId: 'listPoolMembers',
  summary: 'Members of a pool',
  description:
    'Owners first, then by name. Any member may list; `email` is only filled for callers with `members.manage` (owner, admin) and is `null` for everybody else.',
  tags: ['Members'],
  request: { params: z.object({ poolId: PoolId }) },
  responses: {
    200: { description: 'The pool’s members', ...json(MemberListDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/pools/{poolId}/members/{userId}',
  operationId: 'changePoolMemberRole',
  summary: 'Change a member’s role',
  description:
    'Needs `members.manage`. Admins cannot change owners or hand out a role above their own (403); nobody changes their own role (403, owners transfer the pool instead); a user who is not a member of the pool answers 404; taking the role from the last owner answers 409. The member’s sessions in this pool end, so their next request uses the new permissions. Making somebody an owner also needs the caller’s `password` (a missing or wrong one answers 400 with an issue on `password`, counts towards the account’s password-attempt limit and is never echoed or logged); for any other role `password` is not read. The body is `{ role, password? }` and nothing else: `poolId`, `userId` or any other field answers 400.',
  tags: ['Members'],
  request: {
    params: z.object({ poolId: PoolId, userId: UserId }),
    body: { required: true, ...json(UpdateMemberRoleInput) },
  },
  responses: {
    200: { description: 'The member and their new role', ...json(MemberRoleDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/members/{userId}',
  operationId: 'removePoolMember',
  summary: 'Remove a member',
  description:
    'Needs `members.manage`. Admins cannot remove owners (403); removing yourself is `leave` (403); removing the last owner answers 409. The person loses access immediately (their next request gets 404), their sessions in the pool end, and what they created stays in the pool.',
  tags: ['Members'],
  request: { params: z.object({ poolId: PoolId, userId: UserId }) },
  responses: {
    204: { description: 'Member removed' },
    ...errorResponses(401, 403, 404, 409, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/leave',
  operationId: 'leavePool',
  summary: 'Leave a pool',
  description:
    'Any member may leave. The only owner cannot (409): transfer the pool first. What the person created stays in the pool; coming back needs a new invite. No body.',
  tags: ['Members'],
  request: { params: z.object({ poolId: PoolId }) },
  responses: {
    204: { description: 'Left the pool' },
    ...errorResponses(401, 404, 409, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/transfer',
  operationId: 'transferPoolOwnership',
  summary: 'Transfer the pool to another member',
  description:
    'Needs `pool.transfer` (owners). The caller confirms with their password: a wrong one answers 400 with an issue on `password` and counts towards the account’s password-attempt limit (429). The target must be another member (404) who is not an owner yet (409). The caller becomes an admin unless `keepOwnership` is true. The new owner’s sessions in the pool end.',
  tags: ['Members'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(TransferOwnershipInput) },
  },
  responses: {
    200: { description: 'The caller’s role after the transfer', ...json(TransferOwnershipDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});
