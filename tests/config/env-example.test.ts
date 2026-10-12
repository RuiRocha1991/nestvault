import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ENV_KEYS,
  PLATFORM_PROVIDED_KEYS,
  loadEnv,
  loadMigratorEnv,
  loadTestEnv,
} from '@nestvault/config/schema';

const EXAMPLE_PATH = resolve(import.meta.dirname, '../../.env.example');

/** Read by docker-compose and the scripts, not by the application. */
const DOCKER_ONLY_KEYS = [
  'POSTGRES_PORT',
  'POSTGRES_PASSWORD',
  'IDENTITY_RW_PASSWORD',
  'APP_RW_PASSWORD',
  'MIGRATOR_PASSWORD',
];
/** Allow-listed for the browser (packages/config/src/public.ts). */
const PUBLIC_KEYS = ['NEXT_PUBLIC_APP_NAME'];

function parseExample(): Record<string, string> {
  const entries: [string, string][] = [];
  for (const line of readFileSync(EXAMPLE_PATH, 'utf8').split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const index = line.indexOf('=');
    const value = line.slice(index + 1).trim();
    entries.push([line.slice(0, index), value.replace(/^"(.*)"$/, '$1')]);
  }
  return Object.fromEntries(entries);
}

/** What `scripts/init-env.sh` does: fill every __PLACEHOLDER__ with a random value. */
function fillPlaceholders(example: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(example).map(([key, value]) => [
      key,
      value.replace(/__([A-Z0-9_]+)__/g, (_match, name: string) => {
        if (name === 'POSTGRES_PORT') return '5433';
        if (name === 'BETTER_AUTH_SECRET' || name === 'APP_ENCRYPTION_KEY') {
          return randomBytes(32).toString('base64');
        }
        return randomBytes(24).toString('hex');
      }),
    ]),
  );
}

describe('.env.example', () => {
  const example = parseExample();
  const schemaKeys = [...ENV_KEYS.runtime, ...ENV_KEYS.migrator, ...ENV_KEYS.test];

  it('contains every variable the schema reads', () => {
    const missing = schemaKeys
      .filter((key) => !PLATFORM_PROVIDED_KEYS.includes(key))
      .filter((key) => !(key in example));
    expect(missing).toEqual([]);
  });

  it('contains every allow-listed public variable', () => {
    expect(PUBLIC_KEYS.filter((key) => !(key in example))).toEqual([]);
  });

  it('has no stale keys: each one is read by the schema, docker-compose or the browser allow-list', () => {
    const known = new Set([...schemaKeys, ...DOCKER_ONLY_KEYS, ...PUBLIC_KEYS]);
    expect(Object.keys(example).filter((key) => !known.has(key))).toEqual([]);
  });

  it('holds placeholders, never a real secret', () => {
    const placeholder = /^__[A-Z0-9_]+__$/;
    for (const [key, value] of Object.entries(example)) {
      if (/(SECRET|PASSWORD|ENCRYPTION_KEY)$/.test(key) && value !== '') {
        expect(value, key).toMatch(placeholder);
      }
      const url = /^postgres:\/\/[^:]+:([^@]+)@/.exec(value);
      if (url) expect(url[1], key).toMatch(placeholder);
    }
  });

  it('only uses NEXT_PUBLIC_ for names that cannot be mistaken for a secret', () => {
    for (const key of Object.keys(example).filter((name) => name.startsWith('NEXT_PUBLIC_'))) {
      expect(key).not.toMatch(/(KEY|SECRET|TOKEN|PASSWORD)/);
    }
  });

  it('becomes a valid configuration once pnpm env:init fills the placeholders', () => {
    const filled = fillPlaceholders(example);
    expect(() => loadEnv(filled)).not.toThrow();
    expect(() => loadMigratorEnv(filled)).not.toThrow();
    expect(() => loadTestEnv(filled)).not.toThrow();
  });

  it('is rejected as-is, before pnpm env:init', () => {
    expect(() => loadEnv(example)).toThrow(/pnpm env:init/);
  });
});
