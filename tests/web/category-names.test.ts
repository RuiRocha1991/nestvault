import { describe, expect, it } from 'vitest';

import { GLOBAL_CATEGORIES } from '@nestvault/db';
import { SYSTEM_KEYS } from '@nestvault/domain';
import { categoryMessageKey } from '@webapp/lib/category-name';

import messages from '../../apps/web/messages/pt-PT.json' with { type: 'json' };

const names = messages.categories as Record<string, string>;

describe('category names (ADR 0004)', () => {
  it('turns a system key into its message key', () => {
    expect(categoryMessageKey('groceries')).toBe('groceries');
    expect(categoryMessageKey('leisure-travel')).toBe('leisureTravel');
    expect(categoryMessageKey('external-transfers')).toBe('externalTransfers');
  });

  it('has a name in pt-PT for each of the 25 global categories, and no other', () => {
    expect(GLOBAL_CATEGORIES).toHaveLength(25);
    const keys = GLOBAL_CATEGORIES.map((category) => categoryMessageKey(category.systemKey));
    expect(Object.keys(names).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(names[key]?.length ?? 0).toBeGreaterThan(0);
  });

  it('has unique system keys, kinds and colours of the right shape', () => {
    const keys = GLOBAL_CATEGORIES.map((category) => category.systemKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const category of GLOBAL_CATEGORIES) {
      expect(category.systemKey).toMatch(/^[a-z][a-z0-9-]{1,39}$/);
      expect(category.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('includes the system keys the domain engine looks up', () => {
    const keys = GLOBAL_CATEGORIES.map((category) => category.systemKey);
    for (const key of Object.values(SYSTEM_KEYS)) expect(keys).toContain(key);
  });

  it('keeps the prototype’s names', () => {
    expect(names.groceries).toBe('Supermercado');
    expect(names.externalTransfers).toBe('Envios para contas próprias fora da app');
  });
});
