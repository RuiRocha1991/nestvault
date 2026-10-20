import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import messages from '../../apps/web/messages/pt-PT.json';
import { NAV_GROUPS, SECTION_PAGES } from '../../apps/web/src/components/nav';

function leaves(value: unknown, path: string[] = []): { path: string[]; value: unknown }[] {
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key]));
  }
  return [{ path, value }];
}

describe('pt-PT messages', () => {
  it('has only non-empty string values', () => {
    for (const leaf of leaves(messages)) {
      expect(typeof leaf.value, leaf.path.join('.')).toBe('string');
      expect((leaf.value as string).trim(), leaf.path.join('.')).not.toBe('');
    }
  });

  it('uses English camelCase keys', () => {
    for (const leaf of leaves(messages)) {
      for (const key of leaf.path) {
        expect(key, leaf.path.join('.')).toMatch(/^[a-z][a-zA-Z0-9]*$/);
      }
    }
  });

  it('has a label for every navigation group and item', () => {
    for (const group of NAV_GROUPS) {
      expect(messages.nav.groups).toHaveProperty(group.key);
      for (const item of group.items) expect(messages.nav.items).toHaveProperty(item.key);
    }
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('message namespaces', () => {
  it('every literal namespace passed to useTranslations / getTranslations exists in pt-PT.json', () => {
    const root = join(__dirname, '../../apps/web/src');
    const pattern =
      /(?:useTranslations|getTranslations)\(\s*(?:\{\s*[^}]*namespace:\s*)?'([\w.]+)'/g;
    const missing: string[] = [];
    for (const file of sourceFiles(root)) {
      for (const [, namespace] of readFileSync(file, 'utf8').matchAll(pattern)) {
        const found = (namespace ?? '')
          .split('.')
          .reduce<unknown>(
            (node, key) =>
              typeof node === 'object' && node !== null
                ? (node as Record<string, unknown>)[key]
                : undefined,
            messages,
          );
        if (typeof found !== 'object' || found === null)
          missing.push(`${namespace} (${file.slice(root.length + 1)})`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('navigation', () => {
  it('every sidebar link resolves to a screen', () => {
    const slugs = new Set(Object.keys(SECTION_PAGES));
    for (const item of NAV_GROUPS.flatMap((group) => group.items)) {
      if (item.path === '') continue;
      expect(slugs.has(item.path.slice(1)), item.path).toBe(true);
    }
  });
});
