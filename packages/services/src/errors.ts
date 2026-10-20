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
