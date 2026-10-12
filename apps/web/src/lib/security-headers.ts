// Security headers (security control 18). Pure functions, so the policy is unit-tested without a
// server; the middleware only applies the result. This is NOT an authorization check (control 6).

export interface HeaderOptions {
  nonce: string;
  /** `next dev`: React needs eval for debugging and Hot Reload uses a websocket. */
  development: boolean;
  /** The request arrived over HTTPS (directly or behind a TLS proxy). */
  https: boolean;
  pathname: string;
}

/** The Swagger UI page (development only, NES-16) may run its bundled script without a nonce. */
export function isSwaggerDocsPath(pathname: string): boolean {
  return pathname === '/api/docs' || pathname.startsWith('/api/docs/');
}

export function buildCsp({ nonce, development, pathname }: HeaderOptions): string {
  const relaxed = development && isSwaggerDocsPath(pathname);
  const scriptSrc = relaxed
    ? ["'self'", "'unsafe-inline'"]
    : ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(development ? ["'unsafe-eval'"] : [])];
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    // Tailwind and next/font inject inline styles; scripts stay strict.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...(development ? ['ws:', 'wss:'] : [])],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

export function buildSecurityHeaders(options: HeaderOptions): Record<string, string> {
  return {
    'Content-Security-Policy': buildCsp(options),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // Browsers ignore HSTS over plain HTTP, but we also never send it there (localhost stays usable).
    ...(options.https
      ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' }
      : {}),
  };
}

/** A fresh, unguessable value for each request (128 bits, base64). */
export function generateNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}
