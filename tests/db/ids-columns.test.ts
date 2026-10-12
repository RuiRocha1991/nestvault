import { getTableConfig, pgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { isUuid, isUuidV7, money, newId, poolId, quantity, rate } from '@nestvault/db';

describe('newId', () => {
  it('generates UUID v7', () => {
    const id = newId();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
  });

  it('is time ordered and unique', () => {
    const first = newId();
    const ids = Array.from({ length: 200 }, () => newId());
    expect(new Set([first, ...ids]).size).toBe(201);
    expect(first <= (ids.at(-1) ?? '')).toBe(true);
  });
});

describe('isUuid', () => {
  it('accepts UUIDs in either case and rejects everything else', () => {
    expect(isUuid('0190f3a2-7b1c-7d3e-9a4b-1c2d3e4f5a6b')).toBe(true);
    expect(isUuid('0190F3A2-7B1C-7D3E-9A4B-1C2D3E4F5A6B')).toBe(true);
    for (const bad of [
      '',
      'x',
      "' OR 1=1 --",
      '0190f3a2-7b1c-7d3e-9a4b-1c2d3e4f5a6',
      ' 0190f3a2-7b1c-7d3e-9a4b-1c2d3e4f5a6b',
    ]) {
      expect(isUuid(bad), bad).toBe(false);
    }
  });
});

describe('isUuidV7', () => {
  it('accepts v7 ids and rejects other versions, the nil UUID and malformed text', () => {
    expect(isUuidV7(newId())).toBe(true);
    expect(isUuidV7('0190F3A2-7B1C-7D3E-9A4B-1C2D3E4F5A6B')).toBe(true);
    for (const bad of [
      '00000000-0000-0000-0000-000000000000',
      '0190f3a2-7b1c-4d3e-9a4b-1c2d3e4f5a6b', // v4
      '0190f3a2-7b1c-7d3e-ca4b-1c2d3e4f5a6b', // v7 with an invalid variant
      "' OR 1=1 --",
    ]) {
      expect(isUuidV7(bad), bad).toBe(false);
    }
  });
});

describe('column helpers', () => {
  const table = pgTable('t', { m: money('m'), q: quantity('q'), r: rate('r'), p: poolId() });
  const columns = Object.fromEntries(getTableConfig(table).columns.map((c) => [c.name, c]));

  it('use the contracted precisions', () => {
    expect(columns.m?.getSQLType()).toBe('numeric(18, 4)');
    expect(columns.q?.getSQLType()).toBe('numeric(20, 8)');
    expect(columns.r?.getSQLType()).toBe('numeric(9, 6)');
  });

  it('poolId is a uuid that cannot be null', () => {
    expect(columns.pool_id?.getSQLType()).toBe('uuid');
    expect(columns.pool_id?.notNull).toBe(true);
  });
});
