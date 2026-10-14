import { MeDto, RevokedSessionsDto, SessionListDto, UpdateProfileInput } from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, registry } from './registry';

// The signed-in user's own account: outside every pool, so there is no `poolId`. A user can only
// see and end their own sessions. No response carries a session token, a token hash or a full IP.

// The schemas come from the services and are created before the registry extends zod, so they are
// used inline (like the health check) instead of being registered as named components.
const Me = MeDto;
const UpdateProfileBody = UpdateProfileInput;
const SessionList = SessionListDto;
const RevokedSessions = RevokedSessionsDto;
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

registry.registerPath({
  method: 'get',
  path: '/api/v1/me',
  operationId: 'getMe',
  summary: 'The signed-in user',
  tags: ['Account'],
  responses: { 200: { description: 'Profile', ...json(Me) }, ...errorResponses(401, 429, 500) },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/me',
  operationId: 'updateMe',
  summary: 'Change the name of the signed-in user',
  description:
    'Only `name` can change (1-120 characters). To change the email use `POST /api/v1/auth/change-email`: the new address receives a link and the email changes only once it is used.',
  tags: ['Account'],
  request: { body: { required: true, ...json(UpdateProfileBody) } },
  responses: {
    200: { description: 'Updated profile', ...json(Me) },
    ...errorResponses(400, 401, 403, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/me/sessions',
  operationId: 'listMySessions',
  summary: 'Active sessions of the signed-in user',
  description:
    'Browser and system come from the user agent, the address is masked (`85.240.x.x`). `lastActiveAt` is renewed at most once a day while the session is used.',
  tags: ['Account'],
  responses: {
    200: { description: 'Sessions, most recently active first', ...json(SessionList) },
    ...errorResponses(401, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/me/sessions',
  operationId: 'revokeOtherSessions',
  summary: 'End every session except the current one',
  description: 'Requires `others=true`; without it the answer is 400.',
  tags: ['Account'],
  request: { query: z.object({ others: z.literal('true') }) },
  responses: {
    200: { description: 'How many sessions ended', ...json(RevokedSessions) },
    ...errorResponses(400, 401, 403, 429, 500),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/me/sessions/{id}',
  operationId: 'revokeMySession',
  summary: 'End one of the signed-in user’s sessions',
  description:
    'Its cookie stops working at once. The id of another user’s session, an unknown id and a malformed one all answer 404.',
  tags: ['Account'],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: 'Session ended' },
    ...errorResponses(401, 403, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/change-email',
  operationId: 'changeEmail',
  summary: 'Ask to change the email of the signed-in user',
  description:
    'A verification link goes to the new address (`/verificar/{token}`); the email changes only once it is used. An address that is already taken answers the same. Limited to 5 / 15 min per user and per address, together with `change-password`.',
  tags: ['Account'],
  request: {
    body: {
      required: true,
      ...json(
        z.object({ newEmail: z.email().openapi({ example: 'ana.new@example.com' }) }).strict(),
      ),
    },
  },
  responses: {
    200: { description: 'Neutral confirmation', ...json(z.object({ status: z.boolean() })) },
    ...errorResponses(400, 401, 403, 429, 500),
  },
});
