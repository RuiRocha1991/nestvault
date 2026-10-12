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

describe('navigation', () => {
  it('every sidebar link resolves to a screen', () => {
    const slugs = new Set(Object.keys(SECTION_PAGES));
    for (const item of NAV_GROUPS.flatMap((group) => group.items)) {
      if (item.path === '') continue;
      expect(slugs.has(item.path.slice(1)), item.path).toBe(true);
    }
  });
});
