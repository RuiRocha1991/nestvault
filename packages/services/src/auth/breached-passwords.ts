import { createHash } from 'node:crypto';

import type { Logger } from '../logger';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 3_000;

/**
 * Have I Been Pwned range API (k-anonymity): only the first five hex characters of the SHA-1 leave
 * this process, never the password or the full hash. Fails open (returns false and logs a warning)
 * when the service is unreachable, so an outage cannot lock people out of changing a password.
 */
export async function isPasswordBreached(
  password: string,
  options: { fetch?: typeof fetch; log?: Logger } = {},
): Promise<boolean> {
  const doFetch = options.fetch ?? fetch;
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const response = await doFetch(`${RANGE_URL}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = await response.text();
    return body.split('\n').some((line) => {
      const [candidate, count] = line.trim().split(':');
      // Padding entries have a count of 0 and are not real matches.
      return candidate === suffix && Number(count) > 0;
    });
  } catch (error) {
    options.log?.warn(
      { err: error instanceof Error ? error.name : 'unknown' },
      'breached-password check unavailable; allowing the password',
    );
    return false;
  }
}
