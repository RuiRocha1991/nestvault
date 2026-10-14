const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const IPV6 = /^[0-9a-f:]+$/i;

/**
 * Hides the end of an address so that the sessions list shows where, not who: `85.240.x.x`, or
 * the first two groups of an IPv6 address. Anything that is not an address gives `null`.
 */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const address = MAPPED_IPV4.exec(ip)?.[1] ?? ip;
  const v4 = IPV4.exec(address);
  if (v4) return `${v4[1]}.${v4[2]}.x.x`;
  if (ip.includes(':') && IPV6.test(ip)) {
    const groups = ip.split(':').filter((group) => group.length > 0);
    return groups.length >= 2 ? `${groups[0]}:${groups[1]}:…` : null;
  }
  return null;
}
