import type { ZodError } from 'zod';

import { ValidationError } from './errors';

/** The value at `path` of the input, or undefined when it is not there. */
function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let current = input;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

/**
 * The 400 for a failed zod parse. It names the fields the client sent and got wrong (so a form can
 * mark them) and the "unknown key" issue (empty path). A field that was not sent is not named, so
 * the schema's shape stays private, and neither values nor zod's messages travel back.
 */
export function zodProblem(error: ZodError, input: unknown): ValidationError {
  const paths = new Set(
    error.issues
      .filter((issue) => issue.path.length === 0 || valueAt(input, issue.path) !== undefined)
      .map((issue) => issue.path.map(String).join('.')),
  );
  return new ValidationError(
    'The request is not valid.',
    [...paths].map((path) => ({ path, message: 'Invalid value.' })),
  );
}
