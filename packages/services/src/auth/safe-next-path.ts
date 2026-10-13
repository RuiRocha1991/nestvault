/** Where the user lands after signing in when `next` is missing or unsafe. */
export const DEFAULT_AFTER_SIGN_IN = '/pools';

const MAX_NEXT_LENGTH = 2048;
// A base that no real path can match, so a path that escapes it (`//host`, `/\host`) is detected.
const PROBE_ORIGIN = 'http://next.invalid';

/**
 * Validates the `next` parameter of the sign-in page: only a same-origin relative path is accepted
 * (an open redirect would turn the login page into a phishing helper). Returns the path with its
 * query string, or `null` when `raw` is missing or unsafe.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return null;
  // Control characters (tab, CR, LF, NUL) are stripped by URL parsers: `/\t/evil.com` would become `//evil.com`.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;

  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;
  // The sign-in page itself is never a destination (it would loop).
  if (url.pathname === '/login') return null;
  const normalized = `${url.pathname}${url.search}`;
  // Dot segments are resolved by the parser: `/..//evil.com` becomes `//evil.com`, which a browser
  // treats as another host. The check therefore runs on the normalized path too.
  if (normalized.startsWith('//')) return null;
  return normalized;
}
