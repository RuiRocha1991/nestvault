import { NextResponse, type NextRequest } from 'next/server';

import { NEXT_PATH_HEADER } from './lib/next-path-header';
import { buildSecurityHeaders, generateNonce } from './lib/security-headers';

// Headers only. Authentication and authorization are checked in the services (security control 6),
// never here.
export function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const https =
    request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  const headers = buildSecurityHeaders({
    nonce,
    // NODE_ENV is inlined by Next at build time and is not a configuration value.
    // eslint-disable-next-line no-restricted-syntax
    development: process.env.NODE_ENV === 'development',
    https,
    pathname: request.nextUrl.pathname,
  });

  // Next.js reads the nonce from the request's CSP header and puts it on its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Only so that a page can build `/login?next=…`; it is overwritten here, never taken from the client.
  requestHeaders.set(NEXT_PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  requestHeaders.set('Content-Security-Policy', headers['Content-Security-Policy'] ?? '');

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico).*)' }],
};
