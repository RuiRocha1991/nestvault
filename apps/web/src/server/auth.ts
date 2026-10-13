import { createAuthRuntime, logger, type Auth } from '@nestvault/services';

let instance: Promise<Auth> | undefined;

/**
 * The one Better Auth instance of the web process. Built on first use (not at import), so that
 * building the app needs no environment and tests can mock this module. The promise is cached, so
 * concurrent first requests share one instance and one database pool.
 */
export function getAuth(): Promise<Auth> {
  instance ??= import('@nestvault/config').then(({ env }) =>
    createAuthRuntime({
      identityDatabaseUrl: env.DATABASE_URL_IDENTITY,
      appUrl: env.APP_URL,
      secret: env.BETTER_AUTH_SECRET,
      allowSignup: env.ALLOW_SIGNUP,
      log: logger,
    }),
  );
  instance.catch(() => {
    instance = undefined;
  });
  return instance;
}
