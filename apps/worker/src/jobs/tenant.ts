import type { IdentityDatabase, PoolRunner } from '@nestvault/db';

/**
 * What the jobs that visit every pool need besides their own logic: the identity database (the
 * list of pools, housekeeping), `withPool` as the worker builds it, and where uploads are stored.
 */
export interface TenantJobDeps {
  identity: Pick<IdentityDatabase, 'db'>;
  run: PoolRunner;
  /** Absolute path of `IMPORT_STORAGE_DIR`. */
  storageDir: string;
  now?: () => Date;
}

/** The calendar day of `instant` in Lisbon (`yyyy-mm-dd`), the zone every schedule is written in. */
export function lisbonDay(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
