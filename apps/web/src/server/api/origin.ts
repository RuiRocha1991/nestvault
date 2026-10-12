import { ForbiddenError } from '@nestvault/services';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isWriteMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * CSRF defence for Route Handlers (security control 9): a state-changing request must say it comes
 * from this app. A missing `Origin` is rejected too, so a forged form post cannot slip through.
 */
export function assertSameOrigin(req: Request, allowedOrigin: string): void {
  if (!isWriteMethod(req.method)) return;
  if (req.headers.get('origin') !== allowedOrigin) {
    throw new ForbiddenError('The request does not come from this application.');
  }
}

let appOrigin: Promise<string> | undefined;

/** The configured app origin. Loaded on first use so that merely building the app needs no env. */
export function configuredAppOrigin(): Promise<string> {
  appOrigin ??= import('@nestvault/config').then(({ env }) => env.APP_URL);
  appOrigin.catch(() => {
    appOrigin = undefined;
  });
  return appOrigin;
}
