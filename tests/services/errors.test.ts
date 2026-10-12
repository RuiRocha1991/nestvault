import { describe, expect, it } from 'vitest';

import {
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '@nestvault/services';

describe('typed errors', () => {
  it.each([
    [new ValidationError(), 400, 'validation_error'],
    [new UnauthorizedError(), 401, 'unauthorized'],
    [new ForbiddenError(), 403, 'forbidden'],
    [new NotFoundError(), 404, 'not_found'],
    [new ConflictError(), 409, 'conflict'],
    [new PayloadTooLargeError(), 413, 'payload_too_large'],
    [new RateLimitError(30), 429, 'rate_limited'],
  ])('%o maps to %i / %s', (error, status, code) => {
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.name).toBe(error.constructor.name);
  });

  it('carries the retry delay and the validation issues', () => {
    expect(new RateLimitError(30).retryAfterSeconds).toBe(30);
    expect(new ValidationError('bad', [{ path: 'name', message: 'Required' }]).issues).toEqual([
      { path: 'name', message: 'Required' },
    ]);
  });
});
