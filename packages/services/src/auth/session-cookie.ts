// Better Auth names the cookie `<cookiePrefix>.session_token` (cookiePrefix `nv`, see create-auth.ts)
// and adds `__Secure-` on https.
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?nv\.session_token=[^;\s]/;

/**
 * Whether the request carries a session cookie. Together with "no valid session" it means the
 * session expired or was revoked (as opposed to a visitor who never signed in), which the sign-in
 * screen explains. The cookie value is never read or logged here.
 */
export function hasSessionCookie(headers: Headers): boolean {
  return SESSION_COOKIE.test(headers.get('cookie') ?? '');
}
