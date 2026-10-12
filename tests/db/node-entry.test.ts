import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Vitest aliases `server-only` to a stub, so only a real Node process proves that the worker and
// the scripts can load the package (`server-only` throws outside a React Server build).
describe('@nestvault/db in a plain Node process', () => {
  it('loads without server-only and exposes withPool', () => {
    const cwd = resolve(import.meta.dirname, '../../packages/db');
    const out = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        "const db = await import('./src/index.ts'); console.log(typeof db.withPool);",
      ],
      { cwd, encoding: 'utf8' },
    );
    expect(out.trim()).toBe('function');
  });
});
