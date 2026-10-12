import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Source without comments, so the checks look at code only. */
const source = (name: string) =>
  readFileSync(resolve(import.meta.dirname, '../../packages/config/src', name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('server / client boundary (security control 1)', () => {
  it('the main entry point is server-only, so a client component cannot import it', () => {
    expect(source('index.ts')).toMatch(/^import 'server-only';/m);
  });

  it('the public entry point has no server-only and never imports the secret schema', () => {
    const publicSource = source('public.ts');
    expect(publicSource).not.toContain('server-only');
    expect(publicSource).not.toMatch(/from '\.\/(schema|index)'/);
    expect(publicSource).not.toMatch(/from 'zod'/);
  });

  it('the schema stays pure: it does not read process.env itself', () => {
    expect(source('schema.ts')).not.toContain('process.env');
  });

  it('only node.ts and public.ts read process.env', () => {
    expect(source('node.ts')).toContain('process.env');
    expect(source('public.ts')).toContain('process.env.NEXT_PUBLIC_APP_NAME');
    expect(source('index.ts')).not.toContain('process.env');
  });

  it('the Node entry point has no server-only (it throws outside React Server) and reads env lazily', () => {
    const node = source('node.ts');
    expect(node).not.toContain('server-only');
    expect(node).not.toMatch(/^export const \w+ = .*process\.env/m);
  });
});

describe('pnpm gen:secret', () => {
  const run = () =>
    execFileSync('node', [resolve(import.meta.dirname, '../../scripts/gen-secret.mjs')], {
      encoding: 'utf8',
    }).trim();

  it('prints base64 for exactly 32 random bytes', () => {
    const secret = run();
    expect(Buffer.from(secret, 'base64')).toHaveLength(32);
    expect(secret).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it('prints a different value every time', () => {
    expect(run()).not.toBe(run());
  });
});
