import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { describeDiff, diffEnv, parseEnv, syncEnv } from '../../scripts/env-tools';

const EXAMPLE = `# env-version: 3
A=1
SECRET=__SECRET__
URL=postgres://u:__DB_PASSWORD__@h/db
URL_TEST=postgres://u:__DB_PASSWORD__@h/db_test
DB_PASSWORD=__DB_PASSWORD__
`;

const OLD_LOCAL = `# env-version: 1
A=old
DB_PASSWORD=keep-me
`;

const fixed = (name: string) => `<${name}>`;

describe('parseEnv', () => {
  it('reads the version marker and the keys, ignoring comments', () => {
    const parsed = parseEnv(EXAMPLE);
    expect(parsed.version).toBe(3);
    expect([...parsed.values.keys()]).toEqual(['A', 'SECRET', 'URL', 'URL_TEST', 'DB_PASSWORD']);
  });

  it('treats a file without the marker as "no version"', () => {
    expect(parseEnv('A=1\n').version).toBeNull();
  });
});

describe('diffEnv', () => {
  it('lists the missing and the unknown variables by name, with both versions', () => {
    const diff = diffEnv(EXAMPLE, `${OLD_LOCAL}OLD_NAME=x\n`);
    expect(diff).toEqual({
      exampleVersion: 3,
      localVersion: 1,
      missing: ['SECRET', 'URL', 'URL_TEST'],
      unknown: ['OLD_NAME'],
    });
  });

  it('reports nothing when the file is complete', () => {
    const { text } = syncEnv(EXAMPLE, OLD_LOCAL, fixed);
    expect(diffEnv(EXAMPLE, text).missing).toEqual([]);
  });

  it('never puts a value in the report', () => {
    const report = describeDiff(diffEnv(EXAMPLE, 'A=super-secret-value\n')).join('\n');
    expect(report).toContain('SECRET');
    expect(report).not.toContain('super-secret-value');
  });
});

describe('syncEnv', () => {
  it('adds only the missing variables and keeps every existing value', () => {
    const { text, added } = syncEnv(EXAMPLE, OLD_LOCAL, fixed);
    expect(added).toEqual(['SECRET', 'URL', 'URL_TEST']);
    expect(text).toContain('A=old');
    expect(text).toContain('DB_PASSWORD=keep-me');
    expect(text).toContain('SECRET=<SECRET>');
  });

  it('reuses the value the file already has for a placeholder (same database password)', () => {
    const { text } = syncEnv(EXAMPLE, OLD_LOCAL, fixed);
    expect(text).toContain('URL=postgres://u:keep-me@h/db');
    expect(text).toContain('URL_TEST=postgres://u:keep-me@h/db_test');
  });

  it('generates one value per placeholder when the file has none, shared by every use', () => {
    let calls = 0;
    const { text } = syncEnv(EXAMPLE, 'A=1\n', (name) => `${name}-${++calls}`);
    expect(text).toContain('URL=postgres://u:DB_PASSWORD-2@h/db');
    expect(text).toContain('URL_TEST=postgres://u:DB_PASSWORD-2@h/db_test');
  });

  it('brings the version marker up to date, or adds it', () => {
    expect(syncEnv(EXAMPLE, OLD_LOCAL, fixed).text).toMatch(/^# env-version: 3$/m);
    expect(syncEnv(EXAMPLE, 'A=1\n', fixed).text.startsWith('# env-version: 3\n')).toBe(true);
  });

  it('is idempotent', () => {
    const once = syncEnv(EXAMPLE, OLD_LOCAL, fixed).text;
    const twice = syncEnv(EXAMPLE, once, fixed);
    expect(twice.added).toEqual([]);
    expect(twice.text).toBe(once);
  });
});

describe('the repository files', () => {
  const root = resolve(import.meta.dirname, '../..');
  const example = readFileSync(resolve(root, '.env.example'), 'utf8');

  it('.env.example has an env-version and docs/dev-setup.md has a row for it', () => {
    const version = parseEnv(example).version;
    expect(version).not.toBeNull();
    const docs = readFileSync(resolve(root, 'docs/dev-setup.md'), 'utf8');
    expect(docs).toMatch(new RegExp(`^\\| ${String(version)}\\s+\\| NES-\\d+`, 'm'));
  });
});
