import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { type ZodType, z } from 'zod';

// Must run before any schema calls `.openapi()`; every OpenAPI module imports the registry first.
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

/** Cookie created by Better Auth at sign-in (NES-19); sent automatically by the browser. */
export const sessionCookie = registry.registerComponent('securitySchemes', 'sessionCookie', {
  type: 'apiKey',
  in: 'cookie',
  name: 'nv.session_token',
  description: 'Session cookie set at sign-in. In Postman, sign in once and reuse the cookie jar.',
});

/** Shared by every error response: `{ error: { code, message }, requestId }`. */
export const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    error: z.object({
      code: z.string().openapi({ example: 'not_found' }),
      message: z.string().openapi({ example: 'Not found.' }),
      issues: z
        .array(z.object({ path: z.string(), message: z.string() }))
        .optional()
        .openapi({ description: 'Only on 400: which fields are invalid.' }),
    }),
    requestId: z.string().openapi({ example: '5b1f0f6e-3c1d-4c53-9a6b-0f2d3a7c9e11' }),
  }),
);

const ERROR_DESCRIPTIONS = {
  400: 'Validation error',
  401: 'Not signed in',
  403: 'Not allowed (permission, or a request from another origin)',
  404: 'Not found (also returned to non-members of a pool)',
  409: 'Conflict with the current state',
  413: 'Request body too large',
  429: 'Too many requests (see Retry-After)',
  500: 'Unexpected error',
} as const;

type ErrorStatus = keyof typeof ERROR_DESCRIPTIONS;

/** Wraps a zod schema in a JSON content object for OpenAPI request/response bodies. */
export const json = <T extends ZodType>(schema: T) => ({
  content: { 'application/json': { schema } },
});

/** The `responses` entries for the given error statuses, all using the shared body. */
export function errorResponses(...statuses: ErrorStatus[]) {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      {
        description: ERROR_DESCRIPTIONS[status],
        content: { 'application/json': { schema: ErrorResponse } },
      },
    ]),
  );
}
