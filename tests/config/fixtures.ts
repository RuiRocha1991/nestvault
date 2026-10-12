// Obviously fake values, valid for the schema.
export const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:4000',
  ALLOW_SIGNUP: 'false',
  DATABASE_URL_IDENTITY: 'postgres://identity_rw:fake-pw@127.0.0.1:5433/nestvault_identity',
  DATABASE_URL_APP: 'postgres://app_rw:fake-pw@127.0.0.1:5433/nestvault_app',
  BETTER_AUTH_SECRET: 'fake-auth-secret-0123456789-abcdefghijklmnop',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  SMTP_FROM: 'NestVault <no-reply@nestvault.local>',
};

export const VALID_MIGRATOR_ENV: Record<string, string> = {
  MIGRATOR_URL_IDENTITY: 'postgres://nestvault_migrator:fake-pw@127.0.0.1:5433/nestvault_identity',
  MIGRATOR_URL_APP: 'postgres://nestvault_migrator:fake-pw@127.0.0.1:5433/nestvault_app',
};

export const VALID_TEST_ENV: Record<string, string> = {
  TEST_DATABASE_URL_IDENTITY:
    'postgres://identity_rw:fake-pw@127.0.0.1:5433/nestvault_identity_test',
  TEST_DATABASE_URL_APP: 'postgres://app_rw:fake-pw@127.0.0.1:5433/nestvault_app_test',
  TEST_MIGRATOR_URL_IDENTITY:
    'postgres://nestvault_migrator:fake-pw@127.0.0.1:5433/nestvault_identity_test',
  TEST_MIGRATOR_URL_APP: 'postgres://nestvault_migrator:fake-pw@127.0.0.1:5433/nestvault_app_test',
};

/** A copy of `source` without the given keys. */
export function without(
  source: Record<string, string>,
  keys: readonly string[],
): Record<string, string> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
}
