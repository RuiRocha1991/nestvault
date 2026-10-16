import { describe, expect, it } from 'vitest';

import { ALLOWED_META_KEYS, AUDIT_ACTIONS, sanitizeAuditMeta } from '@nestvault/services';

describe('sanitizeAuditMeta', () => {
  it('keeps allow-listed keys with short codes, numbers and booleans', () => {
    expect(
      sanitizeAuditMeta({ role: 'admin', count: 3, reason: 'left', inviteId: 'a1-b2_c3.d4:e5' }),
    ).toEqual({ role: 'admin', count: 3, reason: 'left', inviteId: 'a1-b2_c3.d4:e5' });
  });

  it('keeps the role of the person who acted (NES-123) and drops look-alike keys', () => {
    expect(
      sanitizeAuditMeta({ actorRole: 'admin', actor: 'admin', actorEmail: 'a@b.test' }),
    ).toEqual({
      actorRole: 'admin',
    });
  });

  it.each([
    ['an amount', { amount: 10 }],
    ['an iban', { iban: 'PT50000201231234567890154' }],
    ['a note', { note: 'dinner with Ana' }],
    ['a token', { token: 'abc' }],
  ])('drops %s', (_name, meta) => {
    expect(sanitizeAuditMeta(meta)).toEqual({});
  });

  it.each([
    ['an email', 'ana@example.test'],
    ['free text', 'two words'],
    ['a long value', 'a'.repeat(81)],
    ['an empty value', ''],
    ['an object', { a: 1 }],
    ['null', null],
    ['a non-finite number', Number.POSITIVE_INFINITY],
  ])('drops an allowed key holding %s', (_name, value) => {
    expect(sanitizeAuditMeta({ reason: value })).toEqual({});
  });

  it('gives an empty object for anything that is not an object', () => {
    expect(sanitizeAuditMeta(undefined)).toEqual({});
    expect(sanitizeAuditMeta('role')).toEqual({});
  });

  it('keeps the allow-list free of sensitive names', () => {
    expect(ALLOWED_META_KEYS.join(' ')).not.toMatch(/amount|iban|note|token|email|password/i);
  });

  it('lists the twelve phase 1 actions', () => {
    expect(AUDIT_ACTIONS).toHaveLength(12);
  });
});
