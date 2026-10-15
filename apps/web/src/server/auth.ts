import {
  createAuthRuntime,
  createSmtpSender,
  logger,
  type AccountService,
  type Auth,
  type PoolsService,
  type AuthRuntime,
  type RateLimiter,
} from '@nestvault/services';

let instance: Promise<AuthRuntime> | undefined;

/**
 * The one Better Auth instance and rate limiter of the web process. Built on first use (not at
 * import), so that building the app needs no environment and tests can mock this module. The
 * promise is cached, so concurrent first requests share one instance and one database pool.
 */
function getRuntime(): Promise<AuthRuntime> {
  instance ??= import('@nestvault/config').then(({ env }) => {
    if (env.NODE_ENV === 'production' && env.TRUSTED_PROXY_HOPS < 1) {
      logger.warn(
        'TRUSTED_PROXY_HOPS is 0 in production: the client IP is unknown, so the per-IP sign-in limit is shared and loose. Put the app behind a reverse proxy and set it.',
      );
    }
    return createAuthRuntime({
      identityDatabaseUrl: env.DATABASE_URL_IDENTITY,
      appUrl: env.APP_URL,
      secret: env.BETTER_AUTH_SECRET,
      allowSignup: env.ALLOW_SIGNUP,
      trustedProxyHops: env.TRUSTED_PROXY_HOPS,
      email: createSmtpSender({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        from: env.SMTP_FROM,
        log: logger,
      }),
      log: logger,
    });
  });
  instance.catch(() => {
    instance = undefined;
  });
  return instance;
}

export async function getAuth(): Promise<Auth> {
  return (await getRuntime()).auth;
}

export async function getRateLimiter(): Promise<RateLimiter> {
  return (await getRuntime()).limiter;
}

export async function getAccountService(): Promise<AccountService> {
  return (await getRuntime()).account;
}

export async function getPoolsService(): Promise<PoolsService> {
  return (await getRuntime()).pools;
}
