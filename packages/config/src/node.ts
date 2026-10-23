// Environment loading for Node processes that are not Next.js: migration scripts, the worker and
// the integration tests. `server-only` throws outside a React Server build, so the entry point for
// these processes is separate. Never import it from browser code (ESLint blocks it in apps/web).
import {
  EnvValidationError,
  loadEnv,
  loadMigratorEnv,
  loadSeedEnv,
  loadTestEnv,
  loadWorkerEnv,
  type Env,
  type MigratorEnv,
  type SeedEnv,
  type TestEnv,
  type WorkerEnv,
} from './schema';

/** Fail fast at boot: print variable names and reasons only (never values) and exit. */
function orExit<T>(load: () => T): T {
  try {
    return load();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

/** Runtime configuration (web and worker). Reads `process.env` when called, not on import. */
export function runtimeEnv(): Readonly<Env> {
  return Object.freeze(orExit(() => loadEnv(process.env)));
}

/** Migration user connections (migration tooling only). */
export function migratorEnv(): Readonly<MigratorEnv> {
  return Object.freeze(orExit(() => loadMigratorEnv(process.env)));
}

/** Connection of the worker process (apps/worker only). */
export function workerEnv(): Readonly<WorkerEnv> {
  return Object.freeze(orExit(() => loadWorkerEnv(process.env)));
}

/** `_test` database connections (integration tests only). */
export function testEnv(): Readonly<TestEnv> {
  return Object.freeze(orExit(() => loadTestEnv(process.env)));
}

/** Optional `SEED_OWNER_*` inputs of `pnpm db:seed`. */
export function seedEnv(): Readonly<SeedEnv> {
  return Object.freeze(orExit(() => loadSeedEnv(process.env)));
}
