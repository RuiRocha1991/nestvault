import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads `.env.local` (created by `pnpm env:init`) into the test process. Variables already set,
 * for example by CI, win over the file.
 */
export function loadLocalEnv(): void {
  const file = resolve(import.meta.dirname, '../../.env.local');
  if (existsSync(file)) process.loadEnvFile(file);
}
