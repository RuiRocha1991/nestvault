// Typed errors thrown by services and mapped once to HTTP by the route wrapper (apps/web). They
// carry a stable `code` and a generic `message` that is safe to show to a client: never put user
// data, SQL or internals in them.

export interface ValidationIssue {
  path: string;
  message: string;
}

export abstract class HttpError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends HttpError {
  readonly status = 400;
  readonly code = 'validation_error';

  constructor(
    message = 'The request is not valid.',
    readonly issues: readonly ValidationIssue[] = [],
  ) {
    super(message);
  }
}

export class UnauthorizedError extends HttpError {
  readonly status = 401;
  readonly code = 'unauthorized';

  constructor(message = 'Authentication is required.') {
    super(message);
  }
}

export class ForbiddenError extends HttpError {
  readonly status = 403;
  readonly code = 'forbidden';

  constructor(message = 'You are not allowed to do this.') {
    super(message);
  }
}

export class NotFoundError extends HttpError {
  readonly status = 404;
  readonly code = 'not_found';

  constructor(message = 'Not found.') {
    super(message);
  }
}

export class ConflictError extends HttpError {
  readonly status = 409;
  readonly code = 'conflict';

  /**
   * `current` is the version the caller lost against (optimistic locking). It is data the caller
   * may read anyway, built from an output schema, and is sent as `error.current`.
   */
  constructor(
    message = 'The request conflicts with the current state.',
    readonly current?: unknown,
  ) {
    super(message);
  }
}

export class PayloadTooLargeError extends HttpError {
  readonly status = 413;
  readonly code = 'payload_too_large';

  constructor(message = 'The request body is too large.') {
    super(message);
  }
}

export class UnsupportedMediaTypeError extends HttpError {
  readonly status = 415;
  readonly code = 'unsupported_media_type';

  constructor(message = 'This kind of file is not supported.') {
    super(message);
  }
}

/** The request is well formed but its content cannot be used (a file no parser recognises). */
export class UnprocessableError extends HttpError {
  readonly status = 422;
  readonly code = 'unprocessable';

  constructor(message = 'The content could not be processed.') {
    super(message);
  }
}

/** An internal service the request depends on (the parser) failed or could not be reached. */
export class UpstreamError extends HttpError {
  readonly status = 502;
  readonly code = 'upstream_error';

  constructor(message = 'A service this request depends on is not available. Try again later.') {
    super(message);
  }
}

export class RateLimitError extends HttpError {
  readonly status = 429;
  readonly code = 'rate_limited';

  constructor(
    readonly retryAfterSeconds: number,
    message = 'Too many requests. Try again later.',
  ) {
    super(message);
  }
}

/**
 * The pool's plan does not allow this (a numeric limit reached, or a Pro feature on Free). Sent as
 * 403 `plan_limit` with the `resource` (or feature) and the `limit` (null for a feature) so the UI
 * can show the upgrade prompt. Distinct from `forbidden`, which is about the caller's role.
 */
export class PlanLimitError extends HttpError {
  readonly status = 403;
  readonly code = 'plan_limit';

  constructor(
    readonly resource: string,
    readonly limit: number | null,
    message = 'Your plan does not allow this.',
  ) {
    super(message);
  }
}
