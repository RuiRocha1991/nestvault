import 'server-only';

import { runtimeEnv } from './node';
import type { Env } from './schema';

export {
  ENV_KEYS,
  EnvValidationError,
  loadEnv,
  loadMigratorEnv,
  loadTestEnv,
  type Env,
  type MigratorEnv,
  type TestEnv,
} from './schema';

/** Validated, frozen server configuration. Import it only from server code. */
export const env: Readonly<Env> = runtimeEnv();
