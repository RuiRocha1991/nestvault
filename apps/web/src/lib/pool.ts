import type { PoolSummaryDto } from '@nestvault/services';

/** A pool as the pages receive it; components import this type, never the services root. */
export type PoolSummary = PoolSummaryDto;

/**
 * Shape of the `[poolId]` URL segment: letters, digits and dashes only (a UUID fits).
 * This is only a format check so odd segments never reach links or markup. Whether the user
 * may see the pool is decided by `requirePoolAccess` (NES-25), which answers 404 to non-members.
 */
const POOL_SEGMENT = /^[A-Za-z0-9-]{1,64}$/;

export function isPoolSegment(value: string): boolean {
  return POOL_SEGMENT.test(value);
}
