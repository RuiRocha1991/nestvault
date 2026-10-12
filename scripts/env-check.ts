// pnpm env:check  -> reports what .env.local lacks compared with .env.example (exit 1 if anything).
// pnpm env:sync   -> adds the missing variables, keeps every existing value.
// Prints variable names only, never values.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describeDiff, diffEnv, syncEnv } from './env-tools';

const root = resolve(import.meta.dirname, '..');
const examplePath = resolve(root, '.env.example');
const localPath = resolve(root, '.env.local');

if (!existsSync(localPath)) {
  console.error('.env.local does not exist. Run: pnpm env:init');
  process.exit(1);
}

const example = readFileSync(examplePath, 'utf8');
const local = readFileSync(localPath, 'utf8');

if (process.argv.includes('--sync')) {
  const { text, added } = syncEnv(example, local);
  if (text !== local) {
    writeFileSync(localPath, text);
    chmodSync(localPath, 0o600);
  }
  console.log(
    added.length > 0
      ? `Added to .env.local: ${added.join(', ')}`
      : '.env.local already has every variable.',
  );
  process.exit(0);
}

const diff = diffEnv(example, local);
console.log(describeDiff(diff).join('\n'));
process.exit(diff.missing.length > 0 ? 1 : 0);
