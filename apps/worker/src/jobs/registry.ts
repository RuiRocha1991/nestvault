import { createEcbProvider } from '../index-rates/ecb';

import type { Job } from './define';
import { createIndexRatesJob, type IndexRatesJobDeps } from './index-rates';

export interface ProductionJobDeps {
  /** The worker's connection to the app database, for the jobs about global data. */
  db: IndexRatesJobDeps['db'];
}

/** Every job the production worker runs. Each task adds its own here. */
export function createProductionJobs(deps: ProductionJobDeps): readonly Job[] {
  return [createIndexRatesJob({ db: deps.db, provider: createEcbProvider() })];
}
