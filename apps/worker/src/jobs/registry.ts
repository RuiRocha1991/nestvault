import { createEcbProvider } from '../index-rates/ecb';

import type { Job } from './define';
import { createIndexRatesJob, type IndexRatesJobDeps } from './index-rates';
import { createSessionsCleanupJob } from './sessions-cleanup';
import { createSnapshotsDailyJob } from './snapshots-daily';
import type { TenantJobDeps } from './tenant';

export interface ProductionJobDeps {
  /** The worker's connection to the app database, for the jobs about global data. */
  db: IndexRatesJobDeps['db'];
  /** Identity database, `withPool` and the upload folder, for the jobs that visit every pool. */
  tenant: TenantJobDeps;
}

/** Every job the production worker runs. Each task adds its own here. */
export function createProductionJobs(deps: ProductionJobDeps): readonly Job[] {
  return [
    createIndexRatesJob({ db: deps.db, provider: createEcbProvider() }),
    createSnapshotsDailyJob(deps.tenant),
    createSessionsCleanupJob(deps.tenant),
  ];
}
