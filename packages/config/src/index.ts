import 'server-only';

import { EnvValidationError, loadEnv, type Env } from './schema';

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

// The only place in the repository (besides ./public) that reads process.env.
function loadOrExit(): Readonly<Env> {
  try {
    return Object.freeze(loadEnv(process.env));
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // Fail fast at boot: names and reasons only, never values.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

/** Validated, frozen server configuration. Import it only from server code. */
export const env: Readonly<Env> = loadOrExit();
