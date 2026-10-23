// Pure environment parsing: no `server-only`, no `process.env`, so it can be unit tested.
// `index.ts` feeds it `process.env` once at boot.
import { parseKeyRing } from '@nestvault/crypto';
import { z, type ZodError } from 'zod';

/** Values copied from `.env.example` without running `pnpm env:init`. */
const PLACEHOLDER = /__[A-Z0-9_]+__/;
const PLACEHOLDER_MESSAGE = 'still has a __PLACEHOLDER__ from .env.example; run pnpm env:init';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** A string that must not be an unreplaced placeholder. */
const concrete = (schema: z.ZodString) =>
  schema.refine((value) => !PLACEHOLDER.test(value), PLACEHOLDER_MESSAGE);

/** Empty values in `.env` files (`SMTP_USER=`) mean "not set". */
const optionalText = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const postgresUrl = concrete(z.string()).refine((value) => {
  const url = parseUrl(value);
  return (
    url !== undefined &&
    (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
    url.hostname !== '' &&
    url.username !== '' &&
    url.pathname.length > 1
  );
}, 'must be a postgres:// URL with user, host and database name');

const secret = (minLength: number) => concrete(z.string().min(minLength));

/**
 * AES-256 key: base64 of exactly 32 bytes (what `pnpm gen:secret` prints), or, to rotate, a comma
 * separated list of `id:base64` where the first one is the key new data is encrypted with.
 */
const encryptionKey = concrete(z.string()).refine((value) => {
  try {
    parseKeyRing(value);
    return true;
  } catch {
    return false;
  }
}, 'must be base64 for exactly 32 bytes (or a list of id:base64 keys); generate one with pnpm gen:secret');

const appUrl = concrete(z.string())
  .refine((value) => {
    const url = parseUrl(value);
    if (url === undefined || url.username !== '' || url.password !== '') return false;
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  }, 'must be an origin like https://app.example.com (http only for localhost)')
  .transform((value) => new URL(value).origin);

/** Base URL of the internal parser service: http(s) origin, no credentials, path or query. */
const serviceUrl = concrete(z.string())
  .refine((value) => {
    const url = parseUrl(value);
    if (url === undefined || url.username !== '' || url.password !== '') return false;
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return false;
    return url.protocol === 'http:' || url.protocol === 'https:';
  }, 'must be an origin like http://127.0.0.1:8100')
  .transform((value) => new URL(value).origin);

const strictBoolean = z
  .enum(['true', 'false'], { error: 'must be "true" or "false"' })
  .default('false')
  .transform((value) => value === 'true');

/** Number of reverse proxies we run in front of the app (0-5). 0 ignores `x-forwarded-for`. */
const proxyHops = z
  .string()
  .regex(/^[0-5]$/, 'must be a number from 0 to 5')
  .default('0')
  .transform(Number);

const port = z
  .string()
  .regex(/^\d{1,5}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65535));

// ---------------------------------------------------------------------------------------------
// Variable groups. The web and worker processes only ever receive the runtime group: the
// migration user (owner of the schemas) is read by the migration tooling alone.
// ---------------------------------------------------------------------------------------------

const runtimeShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: appUrl,
  ALLOW_SIGNUP: strictBoolean,
  // Proxies in front of the app that append to x-forwarded-for; 0 = none (header ignored).
  TRUSTED_PROXY_HOPS: proxyHops,
  // Swagger UI and the OpenAPI document at /api/docs; never served when NODE_ENV is production.
  ENABLE_API_DOCS: strictBoolean,
  DATABASE_URL_IDENTITY: postgresUrl,
  DATABASE_URL_APP: postgresUrl,
  BETTER_AUTH_SECRET: secret(32),
  APP_ENCRYPTION_KEY: encryptionKey,
  // Internal statement parser (services/parser): base URL and the shared secret sent with every call.
  PARSER_URL: serviceUrl,
  PARSER_SECRET: secret(32),
  // Where uploaded statements are kept, encrypted (relative paths are from the repository root).
  IMPORT_STORAGE_DIR: concrete(z.string().min(1).max(300)).refine(
    (value) => !value.includes('\0'),
    'must be a directory path',
  ),
  SMTP_HOST: concrete(z.string().min(1)),
  SMTP_PORT: port,
  SMTP_USER: optionalText,
  SMTP_PASSWORD: optionalText,
  SMTP_FROM: concrete(z.string().min(1)),
};

const migratorShape = {
  MIGRATOR_URL_IDENTITY: postgresUrl,
  MIGRATOR_URL_APP: postgresUrl,
};

const testShape = {
  TEST_DATABASE_URL_IDENTITY: postgresUrl,
  TEST_DATABASE_URL_APP: postgresUrl,
  TEST_MIGRATOR_URL_IDENTITY: postgresUrl,
  TEST_MIGRATOR_URL_APP: postgresUrl,
};

/** Never joined: the two URLs of a pair must point at different databases. */
function differentDatabases<K extends string>(identityKey: K, appKey: K) {
  return (value: Record<K, string>, context: z.RefinementCtx) => {
    const identity = parseUrl(value[identityKey]);
    const app = parseUrl(value[appKey]);
    if (identity && app && identity.host === app.host && identity.pathname === app.pathname) {
      context.addIssue({
        code: 'custom',
        path: [appKey],
        message: `must point at a different database than ${identityKey}`,
      });
    }
  };
}

/** Optional inputs of `pnpm db:seed`; not part of the app runtime and not in `.env.example`. */
const seedShape = {
  SEED_OWNER_EMAIL: optionalText,
  SEED_OWNER_PASSWORD: optionalText,
  SEED_OWNER_NAME: optionalText,
};

const runtimeSchema = z
  .object(runtimeShape)
  .superRefine(differentDatabases('DATABASE_URL_IDENTITY', 'DATABASE_URL_APP'));
const migratorSchema = z
  .object(migratorShape)
  .superRefine(differentDatabases('MIGRATOR_URL_IDENTITY', 'MIGRATOR_URL_APP'));
const testSchema = z
  .object(testShape)
  .superRefine(differentDatabases('TEST_DATABASE_URL_IDENTITY', 'TEST_DATABASE_URL_APP'))
  .superRefine(differentDatabases('TEST_MIGRATOR_URL_IDENTITY', 'TEST_MIGRATOR_URL_APP'));

export type Env = z.infer<typeof runtimeSchema>;
export type MigratorEnv = z.infer<typeof migratorSchema>;
export type TestEnv = z.infer<typeof testSchema>;

/** Names of every variable each group reads (used by the `.env.example` completeness test). */
export const ENV_KEYS = {
  runtime: Object.keys(runtimeShape),
  migrator: Object.keys(migratorShape),
  test: Object.keys(testShape),
} as const;

/** Variables the platform provides; they do not belong in `.env.example`. */
export const PLATFORM_PROVIDED_KEYS: readonly string[] = ['NODE_ENV'];

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface EnvIssue {
  name: string;
  reason: string;
}

/**
 * Lists what is wrong with the environment. It carries variable NAMES and fixed reasons only:
 * the rejected value is never part of the message, because it may be a secret.
 */
export class EnvValidationError extends Error {
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[]) {
    super(
      [
        'Invalid environment variables:',
        ...issues.map((issue) => `  - ${issue.name}: ${issue.reason}`),
        'See .env.example (pnpm env:init creates .env.local with working values;\n' +
          'pnpm env:check lists the variables your .env.local lacks, pnpm env:sync adds them).',
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

function reasonFor(issue: ZodError['issues'][number]): string {
  switch (issue.code) {
    case 'custom':
      return issue.message; // our own static messages
    case 'invalid_type':
      return issue.input === undefined ? 'is required' : 'has the wrong type';
    case 'too_small':
      return 'is too short or too small';
    case 'too_big':
      return 'is too long or too large';
    case 'invalid_format':
      return 'has an invalid format';
    case 'invalid_value':
      return issue.message; // enum errors list the allowed values, not the received one
    default:
      return 'is invalid';
  }
}

function parseOrThrow<T extends z.ZodType>(schema: T, source: EnvSource): z.output<T> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  throw new EnvValidationError(
    result.error.issues.map((issue) => ({
      name: String(issue.path[0] ?? 'environment'),
      reason: reasonFor(issue),
    })),
  );
}

/** Runtime configuration of the web and worker processes. */
export function loadEnv(source: EnvSource): Env {
  return parseOrThrow(runtimeSchema, source);
}

/** Migration user connections; read only by the migration tooling. */
export function loadMigratorEnv(source: EnvSource): MigratorEnv {
  return parseOrThrow(migratorSchema, source);
}

const seedSchema = z.object(seedShape);
export type SeedEnv = z.infer<typeof seedSchema>;

/** Inputs of the seed script; all optional (the script prompts for what is missing). */
export function loadSeedEnv(source: EnvSource): SeedEnv {
  return parseOrThrow(seedSchema, source);
}

/** Connections to the `_test` databases; read only by the integration tests. */
export function loadTestEnv(source: EnvSource): TestEnv {
  return parseOrThrow(testSchema, source);
}
