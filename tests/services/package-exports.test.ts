import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../packages/services');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  exports: Record<string, string>;
};

describe('@nestvault/services exports', () => {
  it('exposes only the root and the pure password policy, and the files exist', () => {
    expect(Object.keys(pkg.exports).sort()).toEqual(['.', './password-policy']);
    for (const target of Object.values(pkg.exports)) {
      expect(existsSync(resolve(root, target)), target).toBe(true);
    }
  });

  it('keeps the password policy free of imports, so it is safe in the browser bundle', () => {
    const source = readFileSync(resolve(root, 'src/auth/password-policy.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});
