import { AcceptInviteDto, CreateInviteInput, InviteDto, InviteListDto } from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Invites to join a pool (PRD 01). A pool's invites are guarded by session, membership (404 for
// non-members) and `members.invite` (403). The link in the email carries a 256-bit token that is
// stored only as a SHA-256 hash; no response ever contains the token or its hash.

const PoolId = z.uuid();
const InviteId = z.uuid();

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/invites',
  operationId: 'listPoolInvites',
  summary: 'Pending invites of a pool',
  description:
    'Invites that were neither accepted nor cancelled, newest first; expired ones are listed too so they can be resent. Needs `members.invite` (owner, admin).',
  tags: ['Invites'],
  request: { params: z.object({ poolId: PoolId }) },
  responses: {
    200: { description: 'Pending invites', ...json(InviteListDto) },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/invites',
  operationId: 'createPoolInvite',
  summary: 'Invite somebody to a pool by email',
  description:
    'Sends a pt-PT email with a single-use link (`/convite/{token}`) valid for 7 days. The role cannot be above the inviter’s own (an admin cannot invite an owner: 403). Inviting an address that already has a pending invite replaces it (the old link stops working); an address that is already a member answers 409. 20 invites a day per pool (429). A Free pool (with `BILLING_ENABLED=true`) has room only for its owner: any invite answers 403 `plan_limit`. Unknown fields (`poolId`, `id`, `invitedBy`…) answer 400.',
  tags: ['Invites'],
  request: {
    params: z.object({ poolId: PoolId }),
    body: { required: true, ...json(CreateInviteInput) },
  },
  responses: {
    201: { description: 'The pending invite', ...json(InviteDto) },
    ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/pools/{poolId}/invites/{id}',
  operationId: 'cancelPoolInvite',
  summary: 'Cancel a pending invite',
  description:
    'Its link stops working. The id of an invite of another pool, an accepted one, an unknown or a malformed one answers 404. An admin cannot cancel an invite for an owner (403).',
  tags: ['Invites'],
  request: { params: z.object({ poolId: PoolId, id: InviteId }) },
  responses: {
    204: { description: 'Invite cancelled' },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/invites/{id}/resend',
  operationId: 'resendPoolInvite',
  summary: 'Send a pending invite again',
  description:
    'Creates a new link with a new 7-day expiry and emails it; the previous link stops working. Counts towards the 20 invites a day per pool. No body.',
  tags: ['Invites'],
  request: { params: z.object({ poolId: PoolId, id: InviteId }) },
  responses: {
    200: { description: 'The invite with its new expiry', ...json(InviteDto) },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/invites/{token}/accept',
  operationId: 'acceptInvite',
  summary: 'Accept an invite',
  description:
    'The signed-in user joins the pool with the invited role. The session’s email must be verified and equal the invite’s address. An unknown, expired or used token, another account’s invite and an unverified address all answer the same 404, so nothing is confirmed about a token. Single use: the membership and `accepted_at` are written in one transaction. A pool on the Free plan has no free seat: 403 `plan_limit`. No body.',
  tags: ['Invites'],
  request: { params: z.object({ token: z.string().length(43) }) },
  responses: {
    200: { description: 'The pool the user joined', ...json(AcceptInviteDto) },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});
