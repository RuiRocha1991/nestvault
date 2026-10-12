import {
  pino,
  type Bindings,
  type ChildLoggerOptions,
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from 'pino';

export type { Logger } from 'pino';

export const CENSOR = '[REDACTED]';

/**
 * Any field whose name contains one of these words is censored, whatever the case or separator
 * (`password`, `newPassword`, `access_token`, `IBAN`, `Set-Cookie`, `x-api-key`, `passwordHash`,
 * `description`, ...). Logs never carry amounts, IBANs, emails, tokens, passwords or user text
 * (security control 15). Matching by substring errs on the side of hiding too much.
 */
export const SENSITIVE_KEY =
  /pass(word|wd)|token|secret|session|cookie|authorization|api[-_]?key|credential|iban|email|amount|balance|note|body|description/i;

/** Objects nested deeper than this are replaced, because their keys can no longer be checked. */
const MAX_DEPTH = 12;

/** A copy of `value` in which every sensitive field is censored, at any depth. */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value !== 'object' || value === null) return value;
  // Errors are reduced by `serializeError`; a Date or a Buffer carries no field names.
  if (value instanceof Error || value instanceof Date || ArrayBuffer.isView(value)) return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return CENSOR;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? CENSOR : redact(item, depth + 1, seen),
    ]),
  );
}

/**
 * Errors are logged as type, code and stack frames only. The message is left out on purpose:
 * Drizzle and pg put query parameters (amounts, notes, emails) in it.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error };
  const stack = (error.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');
  const cause: unknown = error.cause;
  const code = (error as { code?: unknown }).code;
  const causeCode = cause instanceof Error ? (cause as { code?: unknown }).code : undefined;
  return {
    type: error.name,
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof causeCode === 'string' ? { causeCode } : {}),
    stack,
  };
}

export interface LoggerConfig {
  level?: LoggerOptions['level'];
  /** Where the JSON lines go; tests pass a stream, production uses stdout. */
  destination?: DestinationStream;
}

export function createLogger({ level = 'info', destination }: LoggerConfig = {}): Logger {
  const options: LoggerOptions = {
    level,
    base: null,
    serializers: { err: serializeError, error: serializeError },
    formatters: {
      level: (label) => ({ level: label }),
      // Runs on every log object, whatever the caller passed.
      log: (object) => redact(object) as Record<string, unknown>,
    },
  };
  const root = destination ? pino(options, destination) : pino(options);
  // pino does not run `formatters` on child bindings: censor them here. Children are created from
  // their parent, so they inherit this `child`.
  type ChildFn = (this: Logger, bindings: Bindings, options?: ChildLoggerOptions) => Logger;
  const originalChild = Reflect.get(root, 'child') as unknown as ChildFn;
  Reflect.set(root, 'child', function censoredChild(
    this: Logger,
    bindings: Bindings,
    options?: ChildLoggerOptions,
  ) {
    return originalChild.call(this, redact(bindings) as Bindings, options);
  } satisfies ChildFn);
  return root;
}

/** The process-wide logger. Fields on every line: request_id, user_id, pool_id when known. */
export const logger: Logger = createLogger();
