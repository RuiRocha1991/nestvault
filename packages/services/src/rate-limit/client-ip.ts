/** Key used when no trusted proxy tells us who the client is; it selects the loose shared bucket. */
export const UNTRUSTED_CLIENT_KEY = 'untrusted-proxy';

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]{2,45}$/;

function isIp(value: string): boolean {
  return IPV4.test(value) || (value.includes(':') && IPV6.test(value));
}

/**
 * The client address for per-IP limits.
 *
 * `x-forwarded-for` is a header the client can set, so it is read only when `trustedProxyHops` > 0,
 * i.e. when that many proxies we run append to it: the address `trustedProxyHops` entries from the
 * right is the one the outermost trusted proxy saw (anything further left is client-controlled).
 * Without a trusted proxy the header is ignored entirely and every client shares one key (and a loose limit, so nobody is locked out by somebody else): Next.js
 * fills `x-forwarded-for` from the socket only when the client did not send it, so the real socket
 * address cannot be told apart from a spoofed one inside a Route Handler.
 */
export function getClientIp(headers: Headers, trustedProxyHops: number): string {
  if (trustedProxyHops < 1) return UNTRUSTED_CLIENT_KEY;
  const entries = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidate = entries[entries.length - trustedProxyHops];
  return candidate && isIp(candidate) ? candidate : UNTRUSTED_CLIENT_KEY;
}
