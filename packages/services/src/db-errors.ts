// Drizzle wraps the driver error: the Postgres code is on `cause`.
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

function hasCode(error: unknown, code: string): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === code;
}

export const isUniqueViolation = (error: unknown) => hasCode(error, UNIQUE_VIOLATION);
export const isForeignKeyViolation = (error: unknown) => hasCode(error, FOREIGN_KEY_VIOLATION);

/** The name of the constraint a Postgres error is about, when the driver gives it. */
export function violatedConstraint(error: unknown): string | undefined {
  const cause = error instanceof Error ? error.cause : undefined;
  if (typeof cause !== 'object' || cause === null || !('constraint' in cause)) return undefined;
  return typeof cause.constraint === 'string' ? cause.constraint : undefined;
}
