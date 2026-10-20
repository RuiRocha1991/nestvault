import {
  ConflictError,
  HttpError,
  logger,
  RateLimitError,
  ValidationError,
  type Logger,
} from '@nestvault/services';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { assertSameOrigin, configuredAppOrigin, isWriteMethod } from './origin';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface RouteContext<P> {
  params: Promise<P>;
  requestId: string;
  /** Carries `request_id`, and `user_id` / `pool_id` once `setActor` has been called. */
  readonly log: Logger;
  /** Call after the session / pool is known so that the log lines carry the ids. */
  setActor(actor: { userId?: string; poolId?: string }): void;
}

export type RouteHandler<P> = (req: Request, ctx: RouteContext<P>) => Promise<Response>;

export interface RouteOptions {
  /** Only tests pass these. */
  appOrigin?: () => Promise<string> | string;
  logger?: Logger;
}

/** A client-supplied id is kept only when it cannot be used to forge log lines. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

function requestIdOf(req: Request): string {
  const supplied = req.headers.get(REQUEST_ID_HEADER);
  return supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
}

// Paths that carry a secret in a segment; the access log shows a placeholder instead (control 15).
const SECRET_SEGMENT_PATHS = [/^(\/api\/v1\/invites\/)[^/]+/];

/** The path as it may appear in a log line: a token in the address never reaches the log. */
export function loggablePath(pathname: string): string {
  return SECRET_SEGMENT_PATHS.reduce(
    (path, pattern) => path.replace(pattern, '$1:token'),
    pathname,
  );
}

function errorBody(
  code: string,
  message: string,
  requestId: string,
  extra: Record<string, unknown> = {},
) {
  return { error: { code, message, ...extra }, requestId };
}

/** Maps anything thrown to the one public error shape. Never exposes stacks, SQL or causes. */
function toErrorResponse(error: unknown, requestId: string): NextResponse {
  if (error instanceof ZodError) {
    error = new ValidationError(
      'The request is not valid.',
      error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  if (error instanceof HttpError) {
    const headers: Record<string, string> = {};
    if (error instanceof RateLimitError) headers['Retry-After'] = String(error.retryAfterSeconds);
    const extra =
      error instanceof ValidationError
        ? { issues: error.issues }
        : error instanceof ConflictError && error.current !== undefined
          ? { current: error.current }
          : {};
    return NextResponse.json(errorBody(error.code, error.message, requestId, extra), {
      status: error.status,
      headers,
    });
  }
  return NextResponse.json(
    errorBody('internal_error', 'Something went wrong. Try again later.', requestId),
    { status: 500 },
  );
}

/**
 * Adds the request id and, unless the handler chose one, `Cache-Control: no-store`. A response with
 * immutable headers (`Response.redirect()`, a proxied `fetch()` response) is copied first, so
 * the wrapper can never turn a good response into an unwrapped 500.
 */
function withApiHeaders(response: Response, requestId: string): Response {
  const apply = (target: Response) => {
    target.headers.set(REQUEST_ID_HEADER, requestId);
    if (!target.headers.has('Cache-Control')) target.headers.set('Cache-Control', 'no-store');
    return target;
  };
  try {
    return apply(response);
  } catch {
    return apply(new Response(response.body, response));
  }
}

/**
 * Wraps a Route Handler (security controls 9, 15, 17): request id, same-origin check for writes,
 * typed errors to a generic body, one access-log line with the status and duration. The stack of
 * an unexpected error goes to the log, never to the response.
 */
export function route<P = Record<string, never>>(
  handler: RouteHandler<P>,
  options: RouteOptions = {},
): (req: Request, ctx: { params: Promise<P> }) => Promise<Response> {
  const root = options.logger ?? logger;
  const originOf = options.appOrigin ?? configuredAppOrigin;

  return async (req, { params }) => {
    const started = performance.now();
    const requestId = requestIdOf(req);
    let log = root.child({ request_id: requestId });
    const ctx: RouteContext<P> = {
      params,
      requestId,
      get log() {
        return log;
      },
      setActor({ userId, poolId }) {
        log = log.child({
          ...(userId ? { user_id: userId } : {}),
          ...(poolId ? { pool_id: poolId } : {}),
        });
      },
    };

    let response: Response;
    try {
      if (isWriteMethod(req.method)) assertSameOrigin(req, await originOf());
      response = await handler(req, ctx);
    } catch (error) {
      if (error instanceof HttpError) log.warn({ code: error.code }, 'request rejected');
      else if (error instanceof ZodError)
        log.warn({ code: 'validation_error' }, 'request rejected');
      else log.error({ err: error }, 'unhandled error');
      response = toErrorResponse(error, requestId);
    }

    response = withApiHeaders(response, requestId);
    log.info(
      {
        method: req.method,
        path: loggablePath(new URL(req.url).pathname),
        status: response.status,
        duration_ms: Math.round(performance.now() - started),
      },
      'request',
    );
    return response;
  };
}
